import { useEffect, useRef, useState } from "react";
import {
  detectFace,
  INNER_LIP_LOOP,
  LEFT_EYE_LOOP,
  LEFT_EYE_LOWER,
  LEFT_EYE_UPPER,
  OUTER_LOWER_LIP,
  OUTER_UPPER_LIP,
  RIGHT_EYE_LOOP,
  RIGHT_EYE_LOWER,
  RIGHT_EYE_UPPER,
  type FaceColors,
  type FacePts,
} from "@/lib/face";
import type { AvatarEmotion } from "@/lib/ai";
import { audioVisemes } from "@/lib/voice";
import { LiveAvatarStreamPlayer } from "./LiveAvatarStreamPlayer";
import type { AvatarEngine } from "@/lib/store";

export type { AvatarEmotion };
export type AvatarGesture = "idle" | "talk";

const VERT_SRC = `
attribute vec2 aPos;
attribute vec2 aUv;
attribute float aMask;
varying vec2 vUv;
varying float vMask;
uniform vec2 uScale;
uniform vec2 uPivot;
uniform float uTilt;
uniform float uZoom;
uniform vec2 uOffset;
uniform float uImgAspect;

void main() {
  vUv = aUv;
  vMask = aMask;
  vec2 p = aPos - uPivot;
  vec2 pa = vec2(p.x * uImgAspect, p.y);
  float c = cos(uTilt);
  float s = sin(uTilt);
  vec2 rotA = vec2(pa.x * c - pa.y * s, pa.x * s + pa.y * c) * uZoom;
  vec2 rot = vec2(rotA.x / max(uImgAspect, 0.01), rotA.y) + uPivot + uOffset;
  vec2 ndc = (rot * 2.0 - 1.0) * vec2(1.0, -1.0) * uScale;
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

// Pure photo-faithful fragment shader: uses exact photo pixels for eyes, mouth, nose, and skin.
// Zero fake teeth, zero duplicate mouth, zero face distortion.
const FRAG_SRC = `
precision mediump float;
varying vec2 vUv;
varying float vMask;
uniform sampler2D uPhotoTex;
uniform sampler2D uBgTex;
uniform int uMode;
uniform float uBlink;
uniform vec3 uSkinColor;

void main() {
  // Mode 4: Clean background
  if (uMode == 4) {
    gl_FragColor = texture2D(uBgTex, clamp(vUv, 0.002, 0.998));
    return;
  }

  vec4 photoCol = texture2D(uPhotoTex, clamp(vUv, 0.001, 0.999));

  // Mode 0: Photo face mesh with feathering and natural blink eyelid closure
  float alpha = clamp(vMask, 0.0, 1.0);
  if (vMask > 1.5 && uBlink > 0.05) {
    float lidBlend = smoothstep(0.05, 0.75, uBlink) * 0.85;
    photoCol.rgb = mix(photoCol.rgb, uSkinColor, lidBlend);
  }

  gl_FragColor = vec4(photoCol.rgb, alpha);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

const UPPER_LID_MASK_VERTS = [
  ...RIGHT_EYE_UPPER.slice(1, -1),
  ...LEFT_EYE_UPPER.slice(1, -1),
  247,
  30,
  29,
  27,
  28,
  56,
  190,
  467,
  260,
  259,
  257,
  258,
  286,
  414,
];

type FaceRig = {
  N: number;
  baseUv: Float32Array;
  baseZ: Float32Array;
  posBuf: Float32Array;
  uvBuf: Float32Array;
  maskBuf: Float32Array;
  faceIndices: Uint16Array;
  neckPivot: [number, number];
};

function buildFaceRig(face: FacePts): FaceRig {
  const N = face.landmarks.length;
  const baseUv = new Float32Array(N * 2);
  const baseZ = new Float32Array(N);
  const maskBuf = new Float32Array(N);
  maskBuf.fill(1.0);

  const ovalSet = new Set(face.ovalLoop);
  for (let i = 0; i < N; i++) {
    baseUv[i * 2] = face.landmarks[i]![0];
    baseUv[i * 2 + 1] = face.landmarks[i]![1];
    baseZ[i] = face.landmarks[i]![2];
    if (ovalSet.has(i)) {
      maskBuf[i] = 0.05; // Soft feather at face oval
    }
  }

  for (const idx of UPPER_LID_MASK_VERTS) {
    if (idx < N) maskBuf[idx] = 2.5;
  }

  const chinY = face.landmarks[152]![1];
  const neckPivot: [number, number] = [face.center[0], Math.min(0.96, chinY + face.faceH * 0.32)];

  return {
    N,
    baseUv,
    baseZ,
    posBuf: new Float32Array(baseUv),
    uvBuf: new Float32Array(baseUv),
    maskBuf,
    faceIndices: face.faceTris,
    neckPivot,
  };
}

type ExpressionParams = {
  blink: number;
  open: number;
  wide: number;
  yaw3D: number;
  pitch3D: number;
  headRoll: number;
  headDx: number;
  headDy: number;
};

function deformFaceRig(rig: FaceRig, face: FacePts, expr: ExpressionParams) {
  const { N, posBuf, uvBuf, baseUv, baseZ } = rig;
  const aspect = face.aspect;

  posBuf.set(baseUv);
  uvBuf.set(baseUv);

  const mouthCx = (baseUv[61 * 2]! + baseUv[291 * 2]!) * 0.5;
  const mouthCy = (baseUv[13 * 2 + 1]! + baseUv[14 * 2 + 1]!) * 0.5;
  const faceCx = face.center[0];
  const faceCy = face.center[1];

  // Subtle rigid 3D rotation projection (zero face/nose distortion)
  const cosY = Math.cos(expr.yaw3D);
  const sinY = Math.sin(expr.yaw3D);
  const cosP = Math.cos(expr.pitch3D);
  const sinP = Math.sin(expr.pitch3D);
  const focal = face.faceW * 4.2;

  const project3D = (lx: number, ly: number, zVal: number): [number, number] => {
    const dxA = (lx - faceCx) * aspect;
    const dy = ly - faceCy;
    const sculptedZ = -zVal * 0.8 * face.faceW;

    const x1 = dxA * cosY + sculptedZ * sinY;
    const z1 = -dxA * sinY + sculptedZ * cosY;
    const y2 = dy * cosP - z1 * sinP;
    const z2 = dy * sinP + z1 * cosP;
    const pScale = focal / Math.max(face.faceW * 1.5, focal + z2);
    return [faceCx + (x1 * pScale) / aspect, faceCy + y2 * pScale];
  };

  const effectiveOpen = Math.min(0.25, expr.open * 0.35);

  for (let i = 0; i < N; i++) {
    const bx = baseUv[i * 2]!;
    let by = baseUv[i * 2 + 1]!;

    // Very natural, subtle jaw drop for speech without distorting cheekbones or nose
    const py = by - mouthCy;
    if (py > 0 && effectiveOpen > 0.002) {
      const distFromMouth = Math.hypot((bx - mouthCx) * aspect, py);
      if (distFromMouth < face.faceW * 0.38) {
        const jawFactor = Math.max(0, 1 - distFromMouth / (face.faceW * 0.38));
        by += effectiveOpen * face.faceH * 0.06 * jawFactor;
      }
    }

    const [px3, py3] = project3D(bx, by, baseZ[i]!);
    posBuf[i * 2] = px3;
    posBuf[i * 2 + 1] = py3;
  }

  // Smooth eyelid blink closure over exact photo pixels
  const effectiveBlink = Math.min(1, Math.max(0, expr.blink));
  if (effectiveBlink > 0.02) {
    const deformEyelids = (upper: number[], lower: number[]) => {
      for (let k = 1; k < upper.length - 1; k++) {
        const ui = upper[k]!;
        const li = lower[k]!;
        const curUx = posBuf[ui * 2]!;
        const curUy = posBuf[ui * 2 + 1]!;
        const curLx = posBuf[li * 2]!;
        const curLy = posBuf[li * 2 + 1]!;
        const meetX = curUx + (curLx - curUx) * 0.88;
        const meetY = curUy + (curLy - curUy) * 0.88;

        posBuf[ui * 2] = curUx + (meetX - curUx) * effectiveBlink;
        posBuf[ui * 2 + 1] = curUy + (meetY - curUy) * effectiveBlink;
        posBuf[li * 2] = curLx + (meetX - curLx) * effectiveBlink;
        posBuf[li * 2 + 1] = curLy + (meetY - curLy) * effectiveBlink;

        const skinShift = effectiveBlink * face.faceH * 0.015;
        uvBuf[ui * 2 + 1] = baseUv[ui * 2 + 1]! - skinShift;
      }
    };
    deformEyelids(RIGHT_EYE_UPPER, RIGHT_EYE_LOWER);
    deformEyelids(LEFT_EYE_UPPER, LEFT_EYE_LOWER);
  }

  // Head roll / translation around neck pivot
  const [neckX, neckY] = rig.neckPivot;
  for (let i = 0; i < N; i++) {
    const px = (posBuf[i * 2]! - neckX) * aspect;
    const py = posBuf[i * 2 + 1]! - neckY;
    const ca = Math.cos(expr.headRoll);
    const sa = Math.sin(expr.headRoll);
    const rx = (px * ca - py * sa) / aspect;
    const ry = px * sa + py * ca;
    posBuf[i * 2] = neckX + rx + expr.headDx / aspect;
    posBuf[i * 2 + 1] = neckY + ry + expr.headDy;
  }
}

export function AnimatedAvatar({
  src,
  name,
  active,
  emotion = "neutral",
  engine = "mediapipe-mesh",
  liveAvatarUrl = "http://localhost:7860",
  className = "",
}: {
  src: string | null;
  name: string;
  active: boolean;
  emotion?: AvatarEmotion | undefined;
  listening?: boolean | undefined;
  gesture?: AvatarGesture | undefined;
  engine?: AvatarEngine | undefined;
  liveAvatarUrl?: string | undefined;
  className?: string | undefined;
}) {
  const effectiveSrc = src || "/avatars/default.jpg";
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackCanvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [face, setFace] = useState<FacePts | null>(null);
  const [useCanvasFallback, setUseCanvasFallback] = useState(false);

  const activeRef = useRef(active);
  const emotionRef = useRef<AvatarEmotion>(emotion);
  const pointerTiltRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  activeRef.current = active;
  emotionRef.current = emotion;

  useEffect(() => {
    let cancel = false;
    setFace(null);
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = async () => {
      if (cancel) return;
      setImg(i);
      const pts = await detectFace(i, effectiveSrc.slice(-48) + ":" + effectiveSrc.length);
      if (!cancel) setFace(pts);
    };
    i.onerror = () => {
      if (cancel || effectiveSrc === "/avatars/default.jpg") return;
      i.src = "/avatars/default.jpg";
    };
    i.src = effectiveSrc;
    return () => {
      cancel = true;
    };
  }, [effectiveSrc]);

  useEffect(() => {
    if (!img || useCanvasFallback) return;
    const canvas = glCanvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: false, antialias: true });
    if (!gl) {
      setUseCanvasFallback(true);
      return;
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) {
      setUseCanvasFallback(true);
      return;
    }

    const prog = gl.createProgram();
    if (!prog) {
      setUseCanvasFallback(true);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setUseCanvasFallback(true);
      return;
    }
    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const rig = face ? buildFaceRig(face) : null;

    const quadPos = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    const quadUv = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    const quadMask = new Float32Array([1, 1, 1, 1]);
    const quadIdx = new Uint16Array([0, 2, 1, 1, 2, 3]);

    const posVbo = gl.createBuffer();
    const uvVbo = gl.createBuffer();
    const maskVbo = gl.createBuffer();
    const ibo = gl.createBuffer();

    const aPos = gl.getAttribLocation(prog, "aPos");
    const aUv = gl.getAttribLocation(prog, "aUv");
    const aMask = gl.getAttribLocation(prog, "aMask");

    const createTex = (unit: number, source: TexImageSource) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      return tex;
    };

    const skinColor = face?.colors.skin ?? [215, 175, 155];

    const photoTex = createTex(0, img);
    const bgTex = createTex(1, face?.bgCanvas ?? img);

    gl.uniform1i(gl.getUniformLocation(prog, "uPhotoTex"), 0);
    gl.uniform1i(gl.getUniformLocation(prog, "uBgTex"), 1);

    const uScale = gl.getUniformLocation(prog, "uScale");
    const uPivot = gl.getUniformLocation(prog, "uPivot");
    const uTilt = gl.getUniformLocation(prog, "uTilt");
    const uZoom = gl.getUniformLocation(prog, "uZoom");
    const uOffset = gl.getUniformLocation(prog, "uOffset");
    const uImgAspect = gl.getUniformLocation(prog, "uImgAspect");
    const uMode = gl.getUniformLocation(prog, "uMode");
    const uBlink = gl.getUniformLocation(prog, "uBlink");
    const uSkinColor = gl.getUniformLocation(prog, "uSkinColor");

    const imgW = img.naturalWidth || img.width || 512;
    const imgH = img.naturalHeight || img.height || 512;
    gl.uniform1f(uImgAspect, imgW / imgH);
    gl.uniform3f(uSkinColor, skinColor[0] / 255, skinColor[1] / 255, skinColor[2] / 255);

    let raf = 0;
    let lastNow = performance.now();
    let nextBlink = lastNow + 1400;
    let blinkProgress = 1;
    let smoothOpen = 0;
    let smoothYaw3D = 0;
    let smoothPitch3D = 0;

    const drawGeometry = (
      mode: number,
      posData: Float32Array,
      uvData: Float32Array,
      maskData: Float32Array,
      idxData: Uint16Array,
    ) => {
      gl.uniform1i(uMode, mode);

      gl.bindBuffer(gl.ARRAY_BUFFER, posVbo);
      gl.bufferData(gl.ARRAY_BUFFER, posData, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, uvVbo);
      gl.bufferData(gl.ARRAY_BUFFER, uvData, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, maskVbo);
      gl.bufferData(gl.ARRAY_BUFFER, maskData, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aMask);
      gl.vertexAttribPointer(aMask, 1, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxData, gl.STATIC_DRAW);
      gl.drawElements(gl.TRIANGLES, idxData.length, gl.UNSIGNED_SHORT, 0);
    };

    const draw = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.004, (now - lastNow) * 0.001));
      lastNow = now;

      const t = now * 0.001;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(1, Math.round(rect.width * dpr));
      const H = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      gl.viewport(0, 0, W, H);
      gl.clearColor(0.07, 0.08, 0.11, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const isActive = activeRef.current;
      const v = isActive ? audioVisemes() : { level: 0, open: 0, wide: 0, round: 0 };

      const targetOpen = isActive ? Math.min(1, v.open * 0.9) : 0;
      smoothOpen += (targetOpen - smoothOpen) * 0.35;

      const ptr = pointerTiltRef.current;
      const targetYaw3D = Math.sin(t * 0.5) * 0.08 + ptr.x * 0.15;
      const targetPitch3D = Math.sin(t * 0.65) * 0.04 + ptr.y * 0.12;
      smoothYaw3D += (targetYaw3D - smoothYaw3D) * 0.08;
      smoothPitch3D += (targetPitch3D - smoothPitch3D) * 0.08;

      if (now >= nextBlink) {
        blinkProgress = 0;
        nextBlink = now + 2400 + Math.random() * 2200;
      }
      if (blinkProgress < 1) {
        blinkProgress = Math.min(1, blinkProgress + dt / 0.16);
      }
      const blinkCurve = blinkProgress < 1 ? Math.sin(blinkProgress * Math.PI) : 0;

      const sc = Math.max(W / imgW, H / imgH);
      const sx = (imgW * sc) / W;
      const sy = (imgH * sc) / H;
      const pivot = face ? face.center : [0.5, 0.45];

      if (rig && face) {
        const headRoll = Math.sin(t * 0.6) * 0.025;
        const headDx = ptr.x * 0.015 * face.faceW;
        const headDy = ptr.y * 0.015 * face.faceH;

        deformFaceRig(rig, face, {
          blink: blinkCurve,
          open: smoothOpen,
          wide: v.wide,
          yaw3D: smoothYaw3D,
          pitch3D: smoothPitch3D,
          headRoll,
          headDx,
          headDy,
        });

        gl.uniform2f(uScale, sx, sy);
        gl.uniform2f(uPivot, pivot[0]!, pivot[1]!);
        gl.uniform1f(uTilt, 0);
        gl.uniform1f(uZoom, 1.02);
        gl.uniform1f(uBlink, blinkCurve);

        // Pass 0: Clean static background (gives exact depth without background stretching)
        if (face.bgCanvas) {
          gl.uniform2f(uOffset, -smoothYaw3D * 0.015, -smoothPitch3D * 0.012);
          drawGeometry(4, quadPos, quadUv, quadMask, quadIdx);
        }

        // Pass 1: Exact photo face mesh with natural movement and photo fidelity
        gl.uniform2f(uOffset, 0, 0);
        drawGeometry(0, rig.posBuf, rig.uvBuf, rig.maskBuf, rig.faceIndices);
      } else {
        gl.uniform2f(uScale, sx, sy);
        gl.uniform2f(uPivot, pivot[0]!, pivot[1]!);
        gl.uniform1f(uTilt, 0);
        gl.uniform1f(uZoom, 1.02);
        gl.uniform1f(uBlink, blinkCurve);
        drawGeometry(0, quadPos, quadUv, quadMask, quadIdx);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      gl.deleteTexture(photoTex);
      gl.deleteTexture(bgTex);
      gl.deleteBuffer(posVbo);
      gl.deleteBuffer(uvVbo);
      gl.deleteBuffer(maskVbo);
      gl.deleteBuffer(ibo);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [img, face, useCanvasFallback]);

  useEffect(() => {
    if (img && !useCanvasFallback) return;
    const c = fallbackCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let raf = 0;

    const draw = () => {
      const rect = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(1, Math.round(rect.width * dpr));
      const H = Math.max(1, Math.round(rect.height * dpr));
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      ctx.save();
      ctx.clearRect(0, 0, W, H);
      if (img) {
        const sc = Math.max(W / img.width, H / img.height);
        ctx.drawImage(
          img,
          (W - img.width * sc) / 2,
          (H - img.height * sc) / 2,
          img.width * sc,
          img.height * sc,
        );
      }
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [img, useCanvasFallback]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    pointerTiltRef.current = {
      x: ((e.clientX - r.left) / r.width) * 2 - 1,
      y: ((e.clientY - r.top) / r.height) * 2 - 1,
    };
  };

  const resetPointer = () => {
    pointerTiltRef.current = { x: 0, y: 0 };
  };

  if (engine === "liveavatar") {
    return (
      <div className={`relative overflow-hidden ${className}`}>
        <canvas ref={glCanvasRef} className="h-full w-full object-cover" />
        <LiveAvatarStreamPlayer
          serverUrl={liveAvatarUrl}
          active={active}
          name={name}
          fallbackPhoto={effectiveSrc}
        />
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
    >
      <img
        src={effectiveSrc}
        alt={name}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      {!useCanvasFallback ? (
        <canvas
          ref={glCanvasRef}
          className={`relative h-full w-full object-cover transition-opacity duration-200 ${img ? "opacity-100" : "opacity-0"}`}
        />
      ) : (
        <canvas
          ref={fallbackCanvasRef}
          className={`relative h-full w-full object-cover transition-opacity duration-200 ${img ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}
