import { useEffect, useRef, useState } from "react";
import {
  detectFace,
  INNER_LIP_LOOP,
  INNER_LOWER_LIP,
  INNER_UPPER_LIP,
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

// uMode 0: Photo face mesh (crisp photo pixels; gentle eyelid skin blend during blink so eyelashes never smear into a black bar)
// uMode 1: Natural ivory teeth + warm rose oral cavity + tongue (only visible behind open lips)
// uMode 2: Crisp unwarped eyeball with subtle micro-gaze saccades (zero darkening/black seam)
// uMode 3: Real-teeth photo preservation + smooth oral cavity blend below teeth edge
const FRAG_SRC = `
precision mediump float;
varying vec2 vUv;
varying float vMask;
uniform sampler2D uPhotoTex;
uniform sampler2D uMouthTex;
uniform int uMode;
uniform float uBlink;
uniform float uOpen;
uniform vec3 uEyelidColor;

void main() {
  if (uMode == 1) {
    vec4 mouthCol = texture2D(uMouthTex, clamp(vUv, 0.01, 0.99));
    gl_FragColor = mouthCol;
    return;
  }

  vec4 photoCol = texture2D(uPhotoTex, clamp(vUv, 0.001, 0.999));

  if (uMode == 3) {
    float cavityFade = smoothstep(0.85, 1.45, vMask);
    vec2 cavUv = vec2(clamp(vUv.x, 0.05, 0.95), clamp(0.55 + (vMask - 0.85) * 0.45, 0.45, 0.98));
    vec4 cavCol = texture2D(uMouthTex, cavUv);
    float depthShade = mix(1.0, 0.92, smoothstep(0.25, 0.95, uOpen) * 0.25);
    photoCol.rgb = mix(photoCol.rgb * depthShade, cavCol.rgb, cavityFade);
    gl_FragColor = photoCol;
    return;
  }

  if (uMode == 2) {
    gl_FragColor = photoCol;
    return;
  }

  // Soft natural eyelid skin blend when eyes blink closed (eliminates dark eyelash bar artifact)
  if (vMask > 1.5 && uBlink > 0.18) {
    float lidBlend = smoothstep(0.18, 0.88, uBlink) * clamp(vMask - 1.5, 0.0, 1.0) * 0.68;
    photoCol.rgb = mix(photoCol.rgb, uEyelidColor, lidBlend);
  }

  gl_FragColor = photoCol;
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

/**
 * Generates a realistic, natural 256x128 oral interior + bright ivory teeth + tongue texture.
 */
function createMouthCanvas(colors: FaceColors): HTMLCanvasElement {
  const W = 256;
  const H = 128;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  const [er, eg, eb] = colors.enamel;

  // Warm deep rose-burgundy interior (never stark black)
  const cav = ctx.createRadialGradient(W * 0.5, H * 0.5, 10, W * 0.5, H * 0.52, W * 0.58);
  cav.addColorStop(0, "rgb(82, 24, 30)");
  cav.addColorStop(0.65, "rgb(62, 18, 24)");
  cav.addColorStop(1, "rgb(42, 14, 18)");
  ctx.fillStyle = cav;
  ctx.fillRect(0, 0, W, H);

  // Warm soft coral-pink tongue along the lower center
  const tongueGrad = ctx.createRadialGradient(W * 0.5, H * 0.88, 12, W * 0.5, H * 0.86, W * 0.34);
  tongueGrad.addColorStop(0, "rgb(156, 72, 80)");
  tongueGrad.addColorStop(0.65, "rgb(120, 46, 54)");
  tongueGrad.addColorStop(1, "rgba(62, 18, 24, 0)");
  ctx.fillStyle = tongueGrad;
  ctx.fillRect(0, H * 0.54, W, H * 0.46);

  // Bright natural ivory upper teeth arch (y = 5..64) + subtle lower teeth edge (y = 96..122)
  const archLeft = W * 0.14;
  const archRight = W * 0.86;
  const archW = archRight - archLeft;
  const imgData = ctx.getImageData(0, 0, W, H);
  const px = imgData.data;
  const toothBoundaries = [0, 0.12, 0.24, 0.37, 0.5, 0.63, 0.76, 0.88, 1.0];

  for (let y = 4; y < 66; y++) {
    for (let x = Math.floor(archLeft); x <= Math.ceil(archRight); x++) {
      const u = (x - archLeft) / archW;
      const distCenter = Math.abs(u - 0.5) * 2;
      const topY = 5 - Math.pow(distCenter, 1.9) * 2;
      const toothLen = 54 - Math.pow(distCenter, 1.55) * 16;
      const botY = topY + toothLen;
      if (y < topY || y > botY) continue;

      const vFrac = (y - topY) / Math.max(1, toothLen);
      const bottomEdgeAlpha = vFrac > 0.82 ? 1 - (vFrac - 0.82) / 0.18 : 1;
      const cornerAlpha = Math.max(0, 1 - Math.pow(distCenter, 2.3));
      const topSoft = Math.min(1, 0.72 + vFrac * 0.45);

      let minDist = 1;
      for (const b of toothBoundaries) {
        const d = Math.abs(u - b);
        if (d < minDist) minDist = d;
      }
      const groove = minDist < 0.014 ? 0.88 + (minDist / 0.014) * 0.12 : 1.0;

      const sideShade = 1.0 - Math.pow(distCenter, 1.7) * 0.28;
      const shade = sideShade * topSoft * groove * 0.96;
      const alpha = bottomEdgeAlpha * cornerAlpha * 0.96;

      const off = (y * W + x) * 4;
      const tr = Math.min(248, er * shade);
      const tg = Math.min(244, eg * shade);
      const tb = Math.min(238, eb * shade);

      px[off] = Math.round(px[off]! * (1 - alpha) + tr * alpha);
      px[off + 1] = Math.round(px[off + 1]! * (1 - alpha) + tg * alpha);
      px[off + 2] = Math.round(px[off + 2]! * (1 - alpha) + tb * alpha);
    }
  }

  // Subtle lower teeth hint (for wide open / laughing mouths)
  for (let y = 96; y < 123; y++) {
    for (let x = Math.floor(W * 0.22); x <= Math.ceil(W * 0.78); x++) {
      const u = (x - W * 0.22) / (W * 0.56);
      const distCenter = Math.abs(u - 0.5) * 2;
      const vFrac = (y - 96) / 27;
      const topFade = vFrac < 0.25 ? vFrac / 0.25 : 1;
      const cornerAlpha = Math.max(0, 1 - Math.pow(distCenter, 2.0));
      const shade = (1.0 - Math.pow(distCenter, 1.6) * 0.35) * 0.76;
      const alpha = topFade * cornerAlpha * 0.72;
      const off = (y * W + x) * 4;
      px[off] = Math.round(px[off]! * (1 - alpha) + er * shade * alpha);
      px[off + 1] = Math.round(px[off + 1]! * (1 - alpha) + eg * shade * alpha);
      px[off + 2] = Math.round(px[off + 2]! * (1 - alpha) + eb * shade * alpha);
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Subtle 5px soft lip occlusion at very top edge only (keeps teeth bright & crisp!)
  const topLipRim = ctx.createLinearGradient(0, 0, 0, 7);
  topLipRim.addColorStop(0, "rgba(48, 14, 18, 0.55)");
  topLipRim.addColorStop(1, "rgba(48, 14, 18, 0)");
  ctx.fillStyle = topLipRim;
  ctx.fillRect(0, 0, W, 7);

  return c;
}

type FaceRig = {
  totalVerts: number;
  baseUv: Float32Array;
  baseZ: Float32Array;
  posBuf: Float32Array;
  uvBuf: Float32Array;
  maskBuf: Float32Array;
  photoIndices: Uint16Array;
  haloStart: number;
  haloCount: number;
  edgeStart: number;
  mouthVertCount: number;
  mouthPosBuf: Float32Array;
  mouthUvBuf: Float32Array;
  mouthMaskBuf: Float32Array;
  mouthIndices: Uint16Array;
  eyeVertCount: number;
  eyePosBuf: Float32Array;
  eyeUvBuf: Float32Array;
  eyeIndices: Uint16Array;
  lowerJawWeight: Float32Array;
  upperLipWeight: Float32Array;
  innerBrowWeight: Float32Array;
  outerBrowWeight: Float32Array;
  cheekWeight: Float32Array;
  headWeight: Float32Array;
  torsoWeight: Float32Array;
};

function intersectRect(cx: number, cy: number, dx: number, dy: number) {
  let tMin = Infinity;
  let side = 0;
  if (dy < -1e-5) {
    const t = (0 - cy) / dy;
    if (t > 0 && t < tMin) {
      tMin = t;
      side = 0;
    }
  }
  if (dx > 1e-5) {
    const t = (1 - cx) / dx;
    if (t > 0 && t < tMin) {
      tMin = t;
      side = 1;
    }
  }
  if (dy > 1e-5) {
    const t = (1 - cy) / dy;
    if (t > 0 && t < tMin) {
      tMin = t;
      side = 2;
    }
  }
  if (dx < -1e-5) {
    const t = (0 - cx) / dx;
    if (t > 0 && t < tMin) {
      tMin = t;
      side = 3;
    }
  }
  if (!Number.isFinite(tMin)) tMin = 1;
  return {
    x: Math.min(1, Math.max(0, cx + dx * tMin)),
    y: Math.min(1, Math.max(0, cy + dy * tMin)),
    t: Math.max(1, tMin),
    side,
  };
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

function buildFaceRig(face: FacePts): FaceRig {
  const N = face.landmarks.length;
  const K = face.ovalLoop.length;
  const cx = Math.min(0.88, Math.max(0.12, face.center[0]));
  const cy = Math.min(0.88, Math.max(0.12, face.center[1]));

  const haloVerts: Array<[number, number]> = [];
  const edgeVerts: Array<[number, number, number]> = [];

  for (let i = 0; i < K; i++) {
    const idx = face.ovalLoop[i]!;
    const ox = face.landmarks[idx]![0];
    const oy = face.landmarks[idx]![1];
    const dx = ox - cx;
    const dy = oy - cy;
    const hit = intersectRect(cx, cy, dx, dy);
    const tHalo = 1 + (hit.t - 1) * 0.45;
    haloVerts.push([
      Math.min(1, Math.max(0, cx + dx * tHalo)),
      Math.min(1, Math.max(0, cy + dy * tHalo)),
    ]);
    edgeVerts.push([hit.x, hit.y, hit.side]);
  }

  const corners: Array<[number, number]> = [
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ];

  const haloStart = N;
  const edgeStart = N + K;
  const cornerStart = N + K * 2;
  const totalVerts = N + K * 2 + 4;

  const baseUv = new Float32Array(totalVerts * 2);
  const baseZ = new Float32Array(totalVerts);
  const maskBuf = new Float32Array(totalVerts);

  for (let i = 0; i < N; i++) {
    baseUv[i * 2] = face.landmarks[i]![0];
    baseUv[i * 2 + 1] = face.landmarks[i]![1];
    baseZ[i] = face.landmarks[i]![2];
  }
  for (let i = 0; i < K; i++) {
    baseUv[(haloStart + i) * 2] = haloVerts[i]![0];
    baseUv[(haloStart + i) * 2 + 1] = haloVerts[i]![1];
    baseUv[(edgeStart + i) * 2] = edgeVerts[i]![0];
    baseUv[(edgeStart + i) * 2 + 1] = edgeVerts[i]![1];
  }
  for (let i = 0; i < 4; i++) {
    baseUv[(cornerStart + i) * 2] = corners[i]![0];
    baseUv[(cornerStart + i) * 2 + 1] = corners[i]![1];
  }

  // Mark upper eyelid vertices (> 1.5) so shader softens dark lash line during blinks
  for (const idx of UPPER_LID_MASK_VERTS) {
    if (idx < N) maskBuf[idx] = 2.5;
  }

  const skirtTris: number[] = [];
  for (let i = 0; i < K; i++) {
    const next = (i + 1) % K;
    const o0 = face.ovalLoop[i]!;
    const o1 = face.ovalLoop[next]!;
    const h0 = haloStart + i;
    const h1 = haloStart + next;
    const e0 = edgeStart + i;
    const e1 = edgeStart + next;

    skirtTris.push(o0, h0, o1, o1, h0, h1);

    const s0 = edgeVerts[i]![2];
    const s1 = edgeVerts[next]![2];
    const sideDiff = (s1 - s0 + 4) % 4;
    if (sideDiff === 0 || sideDiff === 3) {
      skirtTris.push(h0, e0, h1, h1, e0, e1);
    } else {
      let curEdge = e0;
      let side = s0;
      let guard = 0;
      while (side !== s1 && guard < 3) {
        const cornerIdx = cornerStart + side;
        skirtTris.push(h0, curEdge, cornerIdx);
        curEdge = cornerIdx;
        side = (side + 1) % 4;
        guard++;
      }
      skirtTris.push(h0, curEdge, e1, h0, e1, h1);
    }
  }

  const photoIndices = new Uint16Array(face.faceTris.length + skirtTris.length);
  photoIndices.set(face.faceTris, 0);
  photoIndices.set(skirtTris, face.faceTris.length);

  const mouthVertCount = INNER_LIP_LOOP.length + 1;
  const mouthTris: number[] = [];
  for (let i = 0; i < INNER_LIP_LOOP.length; i++) {
    const next = (i + 1) % INNER_LIP_LOOP.length;
    mouthTris.push(0, 1 + i, 1 + next);
  }

  const rLen = RIGHT_EYE_LOOP.length;
  const lLen = LEFT_EYE_LOOP.length;
  const rStride = 1 + rLen;
  const lStride = 1 + lLen;
  const eyeVertCount = rStride + lStride;
  const eyeTris: number[] = [];
  const addEyeFan = (off: number, len: number) => {
    const outerStart = off + 1;
    for (let i = 0; i < len; i++) {
      const next = (i + 1) % len;
      eyeTris.push(off, outerStart + i, outerStart + next);
    }
  };
  addEyeFan(0, rLen);
  addEyeFan(rStride, lLen);

  const lowerJawWeight = new Float32Array(N);
  const upperLipWeight = new Float32Array(N);
  const innerBrowWeight = new Float32Array(N);
  const outerBrowWeight = new Float32Array(N);
  const cheekWeight = new Float32Array(N);

  const mouthCx = (face.landmarks[61]![0] + face.landmarks[291]![0]) * 0.5;
  const mouthCy = (face.landmarks[13]![1] + face.landmarks[14]![1]) * 0.5;
  const browMidX = (face.landmarks[107]![0] + face.landmarks[336]![0]) * 0.5;
  const browMidY = (face.landmarks[107]![1] + face.landmarks[336]![1]) * 0.5;
  const rBrowX = face.landmarks[105]![0];
  const rBrowY = face.landmarks[105]![1];
  const lBrowX = face.landmarks[334]![0];
  const lBrowY = face.landmarks[334]![1];
  const rCheekX = face.landmarks[50]![0];
  const rCheekY = face.landmarks[50]![1];
  const lCheekX = face.landmarks[280]![0];
  const lCheekY = face.landmarks[280]![1];

  const { ux, uy, vx, vy } = face.mouthAxis;
  const aspect = face.aspect;

  for (let i = 0; i < N; i++) {
    const px = face.landmarks[i]![0];
    const py = face.landmarks[i]![1];
    const dx = (px - mouthCx) * aspect;
    const dy = py - mouthCy;

    const mx = dx * ux + dy * uy;
    const my = dx * vx + dy * vy;

    // Jaw drop localized to lower face without rubber-banding neck/collar
    if (my >= -face.mouthW * 0.08) {
      const horiz = Math.exp(-Math.pow(mx / (face.faceW * 0.42), 2) * 1.75);
      const vert = Math.min(1.0, Math.max(0, (my + face.mouthW * 0.06) / (face.jawSpan * 0.5)));
      const chinFade =
        my > face.jawSpan * 0.72
          ? Math.exp(-Math.pow((my - face.jawSpan * 0.72) / (face.jawSpan * 0.3), 2))
          : 1;
      lowerJawWeight[i] = horiz * vert * chinFade;
    }

    if (my <= face.mouthW * 0.06) {
      const horiz = Math.exp(-Math.pow(mx / (face.mouthW * 0.55), 2) * 1.8);
      const vert = Math.exp(-Math.pow((my + face.mouthW * 0.05) / (face.mouthW * 0.25), 2) * 1.7);
      upperLipWeight[i] = horiz * vert;
    }

    // Inner brow / glabella weight (critical for angry furrow & sad brow slant)
    const ibDist = Math.hypot(
      ((px - browMidX) * aspect) / (face.faceW * 0.2),
      (py - browMidY) / (face.faceH * 0.12),
    );
    if (ibDist < 2.2) {
      innerBrowWeight[i] = Math.exp(-ibDist * ibDist * 1.25);
    }

    // Outer brow arch weight (for surprise, happy lift, angry outer slant)
    const rbDist = Math.hypot(
      ((px - rBrowX) * aspect) / (face.faceW * 0.22),
      (py - rBrowY) / (face.faceH * 0.11),
    );
    const lbDist = Math.hypot(
      ((px - lBrowX) * aspect) / (face.faceW * 0.22),
      (py - lBrowY) / (face.faceH * 0.11),
    );
    const ob = Math.max(Math.exp(-rbDist * rbDist * 1.4), Math.exp(-lbDist * lbDist * 1.4));
    if (ob > 0.02) outerBrowWeight[i] = ob;

    // Cheek weight (for authentic Duchenne smile / laugh)
    const rcDist = Math.hypot(
      ((px - rCheekX) * aspect) / (face.faceW * 0.24),
      (py - rCheekY) / (face.faceH * 0.18),
    );
    const lcDist = Math.hypot(
      ((px - lCheekX) * aspect) / (face.faceW * 0.24),
      (py - lCheekY) / (face.faceH * 0.18),
    );
    const cw = Math.max(Math.exp(-rcDist * rcDist * 1.35), Math.exp(-lcDist * lcDist * 1.35));
    if (cw > 0.02) cheekWeight[i] = cw;
  }

  for (let k = 0; k < INNER_UPPER_LIP.length; k++) {
    const idx = INNER_UPPER_LIP[k]!;
    const t = k / (INNER_UPPER_LIP.length - 1);
    const arch = Math.pow(Math.sin(Math.PI * t), 1.35);
    lowerJawWeight[idx] = 0;
    upperLipWeight[idx] = arch * 0.78;
  }
  for (let k = 0; k < OUTER_UPPER_LIP.length; k++) {
    const idx = OUTER_UPPER_LIP[k]!;
    const t = k / (OUTER_UPPER_LIP.length - 1);
    const arch = Math.pow(Math.sin(Math.PI * t), 1.4);
    lowerJawWeight[idx] = 0;
    upperLipWeight[idx] = arch * 0.52;
  }
  for (let k = 0; k < INNER_LOWER_LIP.length; k++) {
    const idx = INNER_LOWER_LIP[k]!;
    const t = k / (INNER_LOWER_LIP.length - 1);
    const arch = Math.pow(Math.sin(Math.PI * t), 1.3);
    upperLipWeight[idx] = 0;
    lowerJawWeight[idx] = arch;
  }
  for (let k = 0; k < OUTER_LOWER_LIP.length; k++) {
    const idx = OUTER_LOWER_LIP[k]!;
    const t = k / (OUTER_LOWER_LIP.length - 1);
    const arch = Math.pow(Math.sin(Math.PI * t), 1.35);
    upperLipWeight[idx] = 0;
    lowerJawWeight[idx] = Math.max(lowerJawWeight[idx]!, arch * 0.94);
  }

  // Head + neck articulation weight + lower torso breathing weight
  const headWeight = new Float32Array(totalVerts);
  const torsoWeight = new Float32Array(totalVerts);
  for (let i = 0; i < N; i++) {
    headWeight[i] = 1.0;
  }
  const chinY = face.landmarks[152]![1];
  for (let i = 0; i < K; i++) {
    const hIdx = haloStart + i;
    const hy = baseUv[hIdx * 2 + 1]!;
    if (hy <= chinY + face.faceH * 0.06) {
      headWeight[hIdx] = 0.95;
      torsoWeight[hIdx] = 0.15;
    } else {
      const below = (hy - (chinY + face.faceH * 0.06)) / Math.max(0.08, 1 - chinY);
      headWeight[hIdx] = Math.max(0.1, 0.85 * Math.pow(Math.max(0, 1 - below * 1.15), 1.25));
      torsoWeight[hIdx] = Math.min(1, 0.25 + below * 0.85);
    }
  }

  return {
    totalVerts,
    baseUv,
    baseZ,
    posBuf: new Float32Array(baseUv),
    uvBuf: new Float32Array(baseUv),
    maskBuf,
    photoIndices,
    haloStart,
    haloCount: K,
    edgeStart,
    mouthVertCount,
    mouthPosBuf: new Float32Array(mouthVertCount * 2),
    mouthUvBuf: new Float32Array(mouthVertCount * 2),
    mouthMaskBuf: new Float32Array(mouthVertCount),
    mouthIndices: new Uint16Array(mouthTris),
    eyeVertCount,
    eyePosBuf: new Float32Array(eyeVertCount * 2),
    eyeUvBuf: new Float32Array(eyeVertCount * 2),
    eyeIndices: new Uint16Array(eyeTris),
    lowerJawWeight,
    upperLipWeight,
    innerBrowWeight,
    outerBrowWeight,
    cheekWeight,
    headWeight,
    torsoWeight,
  };
}

type ExpressionParams = {
  blink: number;
  open: number;
  wide: number;
  round: number;
  innerBrowY: number; // + lift, - furrow down
  innerBrowPinch: number; // + pinch toward center (angry)
  outerBrowY: number;
  eyeSquint: number; // 0..0.55 (angry squint or happy Duchenne squint)
  eyeWide: number; // 0..0.3 (surprised wide eyes)
  cheekLift: number;
  smile: number; // -0.5..+1.0
  gazeX: number;
  gazeY: number;
  yawWave: number;
  headRoll: number;
  headDx: number;
  headDy: number;
  torsoBreath: number;
};

function deformFaceRig(rig: FaceRig, face: FacePts, expr: ExpressionParams) {
  const N = face.landmarks.length;
  const { posBuf, uvBuf, baseUv, baseZ, headWeight, torsoWeight } = rig;
  const aspect = face.aspect;
  const { ux, uy, vx, vy } = face.mouthAxis;

  posBuf.set(baseUv);
  uvBuf.set(baseUv);

  const gatedOpen = expr.open < 0.025 ? 0 : expr.open;
  const openScale = face.hasVisibleTeeth ? 0.58 : 0.88;
  const effectiveOpen = Math.min(0.92, gatedOpen * openScale);

  const mouthCx = (baseUv[61 * 2]! + baseUv[291 * 2]!) * 0.5;
  const mouthCy = (baseUv[13 * 2 + 1]! + baseUv[14 * 2 + 1]!) * 0.5;
  const faceCx = face.center[0];
  const faceCy = face.center[1];

  const computeParallax = (bx: number, by: number, z: number): [number, number] => {
    const fx = ((bx - faceCx) * aspect) / face.faceW;
    const fy = (by - faceCy) / face.faceH;
    const fDist2 = Math.min(1.4, fx * fx + fy * fy);
    const dxA = (-z * 1.15 + (0.42 - 0.3 * fDist2) * 0.055) * expr.yawWave * face.faceW;
    const dy = z * expr.headDy * 0.38;
    return [dxA, dy];
  };

  // 1) Local facial expressions (jaw, lips, cheeks, inner/outer brows, 2.5D yaw parallax)
  for (let i = 0; i < N; i++) {
    const bx = baseUv[i * 2]!;
    const by = baseUv[i * 2 + 1]!;
    let [dxA, dy] = computeParallax(bx, by, baseZ[i]!);

    const jW = rig.lowerJawWeight[i]!;
    if (jW > 0.002 && effectiveOpen > 0.002) {
      const drop = effectiveOpen * face.mouthW * 0.26 * jW;
      dxA += vx * drop;
      dy += vy * drop;
    }

    const uW = rig.upperLipWeight[i]!;
    if (uW > 0.002 && (effectiveOpen > 0.002 || expr.wide > 0.01 || expr.smile > 0.05)) {
      const lift =
        (effectiveOpen * 0.018 + expr.wide * 0.012 + Math.max(0, expr.smile) * 0.014) *
        face.mouthW *
        uW;
      dxA -= vx * lift;
      dy -= vy * lift;
    }

    const relX = (bx - mouthCx) * aspect;
    const relY = by - mouthCy;
    const projU = relX * ux + relY * uy;
    const projV = relX * vx + relY * vy;
    const mouthProx =
      Math.exp(-Math.pow(projU / (face.mouthW * 0.65), 2) * 1.6) *
      Math.exp(-Math.pow(projV / (face.mouthW * 0.38), 2) * 1.8);

    if (mouthProx > 0.02) {
      const horizFactor = Math.max(-1, Math.min(1, projU / (face.mouthW * 0.5)));
      const spread =
        (expr.wide * 0.048 + expr.smile * 0.042 - expr.round * 0.058) *
        face.mouthW *
        horizFactor *
        mouthProx;
      const cornerUp =
        (expr.smile * 0.045 + expr.wide * 0.014) * face.mouthW * Math.abs(horizFactor) * mouthProx;
      dxA += ux * spread - vx * cornerUp;
      dy += uy * spread - vy * cornerUp;
    }

    const cW = rig.cheekWeight[i]!;
    if (cW > 0.005 && expr.cheekLift > 0.005) {
      const lift = expr.cheekLift * face.faceH * 0.024 * cW;
      dxA -= face.faceAxis.vx * lift;
      dy -= face.faceAxis.vy * lift;
    }

    const ibW = rig.innerBrowWeight[i]!;
    if (ibW > 0.005) {
      const shiftY = expr.innerBrowY * face.faceH * 0.036 * ibW;
      dxA -= face.faceAxis.vx * shiftY;
      dy -= face.faceAxis.vy * shiftY;
      if (Math.abs(expr.innerBrowPinch) > 0.005) {
        const sideSign = (bx - faceCx) * aspect >= 0 ? -1 : 1;
        const pinch = sideSign * expr.innerBrowPinch * face.faceW * 0.026 * ibW;
        dxA += face.faceAxis.ux * pinch;
        dy += face.faceAxis.uy * pinch;
      }
    }

    const obW = rig.outerBrowWeight[i]!;
    if (obW > 0.005) {
      const shiftY = expr.outerBrowY * face.faceH * 0.036 * obW;
      dxA -= face.faceAxis.vx * shiftY;
      dy -= face.faceAxis.vy * shiftY;
    }

    posBuf[i * 2] = bx + dxA / aspect;
    posBuf[i * 2 + 1] = by + dy;
  }

  const chinY = face.landmarks[152]![1];
  const neckBaseX = face.landmarks[152]![0];
  const neckBaseY = Math.min(0.97, chinY + face.faceH * 0.34);

  const applyHeadNeckTransform = (bx: number, by: number, hw = 1.0): [number, number] => {
    const px = (bx - neckBaseX) * aspect;
    const py = by - neckBaseY;
    const ang = expr.headRoll * hw;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const rx = (px * ca - py * sa) / aspect;
    const ry = px * sa + py * ca;
    const topBoost = Math.max(0, (neckBaseY - by) / (face.faceH * 1.25));
    const turnShift = expr.yawWave * face.faceW * 0.044 * topBoost * hw;
    return [
      neckBaseX + rx + (expr.headDx * hw + turnShift) / aspect,
      neckBaseY + ry + expr.headDy * hw,
    ];
  };

  // 2) Eyelids: smooth 100% blink closure + eye squint / wide + UV upward shift to prevent black eyelash line
  const effectiveBlink = Math.min(1, Math.max(0, expr.blink));
  const lidActivity = Math.max(effectiveBlink, expr.eyeSquint * 0.65);

  if (lidActivity > 0.004 || expr.eyeWide > 0.004) {
    const deformEyeLids = (upper: number[], lower: number[]) => {
      for (let k = 1; k < upper.length - 1; k++) {
        const ui = upper[k]!;
        const li = lower[k]!;
        const ux0 = posBuf[ui * 2]!;
        const uy0 = posBuf[ui * 2 + 1]!;
        const lx0 = posBuf[li * 2]!;
        const ly0 = posBuf[li * 2 + 1]!;

        // Slight widening when surprised
        if (expr.eyeWide > 0.004 && effectiveBlink < 0.2) {
          const widen = expr.eyeWide * (1 - effectiveBlink * 4);
          posBuf[ui * 2 + 1] = uy0 - (ly0 - uy0) * 0.24 * widen;
          posBuf[li * 2 + 1] = ly0 + (ly0 - uy0) * 0.1 * widen;
        }

        // Squint from anger/happiness pulls lower lid slightly up & upper lid slightly down
        if (expr.eyeSquint > 0.004) {
          const sq = expr.eyeSquint;
          posBuf[ui * 2 + 1] = posBuf[ui * 2 + 1]! + (ly0 - uy0) * 0.2 * sq;
          posBuf[li * 2 + 1] = posBuf[li * 2 + 1]! - (ly0 - uy0) * 0.34 * sq;
        }

        // Full blink closure meets cleanly at 88% down / 12% up (zero slit gap!)
        if (effectiveBlink > 0.004) {
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

          // Shift UV of upper lid vertex slightly UP into the real photo eyelid skin (away from dark lash line)
          const skinShift = effectiveBlink * face.faceH * 0.018;
          uvBuf[ui * 2] = baseUv[ui * 2]! - (face.faceAxis.vx * skinShift) / aspect;
          uvBuf[ui * 2 + 1] = baseUv[ui * 2 + 1]! - face.faceAxis.vy * skinShift;
        }
      }
    };
    deformEyeLids(RIGHT_EYE_UPPER, RIGHT_EYE_LOWER);
    deformEyeLids(LEFT_EYE_UPPER, LEFT_EYE_LOWER);

    const creaseFollow = [
      [247, 33],
      [30, 161],
      [29, 160],
      [27, 159],
      [28, 158],
      [56, 157],
      [190, 173],
      [467, 263],
      [260, 388],
      [259, 387],
      [257, 386],
      [258, 385],
      [286, 384],
      [414, 398],
    ];
    for (const [ci, lidIdx] of creaseFollow) {
      const ldx = posBuf[lidIdx! * 2]! - baseUv[lidIdx! * 2]!;
      const ldy = posBuf[lidIdx! * 2 + 1]! - baseUv[lidIdx! * 2 + 1]!;
      posBuf[ci! * 2] = baseUv[ci! * 2]! + ldx * 0.56;
      posBuf[ci! * 2 + 1] = baseUv[ci! * 2 + 1]! + ldy * 0.56;
    }
  }

  // 3) Hair follow-through + subtle upper-chest/shoulder breathing on halo vertices
  for (let i = 0; i < rig.haloCount; i++) {
    const ovalIdx = face.ovalLoop[i]!;
    const hIdx = rig.haloStart + i;
    const hy = baseUv[hIdx * 2 + 1]!;
    if (hy <= chinY - face.faceH * 0.08) {
      const odx = posBuf[ovalIdx * 2]! - baseUv[ovalIdx * 2]!;
      const ody = posBuf[ovalIdx * 2 + 1]! - baseUv[ovalIdx * 2 + 1]!;
      const hairLag = -expr.headRoll * face.faceW * 0.045;
      posBuf[hIdx * 2] = baseUv[hIdx * 2]! + odx * 0.45 + hairLag / aspect;
      posBuf[hIdx * 2 + 1] = baseUv[hIdx * 2 + 1]! + ody * 0.45;
    }
    const tw = torsoWeight[hIdx]!;
    if (tw > 0.01) {
      posBuf[hIdx * 2 + 1] = posBuf[hIdx * 2 + 1]! + expr.torsoBreath * face.faceH * 0.022 * tw;
    }
  }

  // 4) Articulated Head + Neck Motion around collarbone pivot
  for (let i = 0; i < rig.totalVerts; i++) {
    const hw = headWeight[i]!;
    if (hw <= 0.001) continue;
    const [nx, ny] = applyHeadNeckTransform(posBuf[i * 2]!, posBuf[i * 2 + 1]!, hw);
    posBuf[i * 2] = nx;
    posBuf[i * 2 + 1] = ny;
  }

  // 5) Mouth Cavity Fan (expanded behind lips, never shows black rim or flat black teeth bar)
  const { mouthPosBuf, mouthUvBuf, mouthMaskBuf } = rig;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < INNER_LIP_LOOP.length; i++) {
    const lIdx = INNER_LIP_LOOP[i]!;
    sumX += posBuf[lIdx * 2]!;
    sumY += posBuf[lIdx * 2 + 1]!;
  }
  const mCenterX = sumX / INNER_LIP_LOOP.length;
  const mCenterY = sumY / INNER_LIP_LOOP.length;

  const anchorX = posBuf[13 * 2]!;
  const anchorY = posBuf[13 * 2 + 1]!;
  const lowerX = posBuf[14 * 2]!;
  const lowerY = posBuf[14 * 2 + 1]!;
  const currentLipGap = Math.max(
    face.mouthW * 0.14,
    Math.hypot((lowerX - anchorX) * aspect, lowerY - anchorY),
  );
  const restAnchorU = baseUv[13 * 2]!;
  const restAnchorV = baseUv[13 * 2 + 1]!;
  const cosNeg = Math.cos(-expr.headRoll);
  const sinNeg = Math.sin(-expr.headRoll);
  const teethDepth = Math.max(0.012, face.restTeethDepth);

  const mapRealPhotoMouth = (px: number, py: number): [number, number, number] => {
    const dxA = (px - anchorX) * aspect;
    const dy = py - anchorY;
    const rdxA = dxA * cosNeg - dy * sinNeg;
    const rdy = dxA * sinNeg + dy * cosNeg;
    const depthMask = Math.max(0, rdy / teethDepth);
    const clampedRdy = Math.min(rdy, teethDepth * 0.92);
    return [restAnchorU + rdxA / aspect, restAnchorV + clampedRdy, depthMask];
  };

  const mapSynthMouth = (px: number, py: number): [number, number] => {
    const dxA = (px - anchorX) * aspect;
    const dy = py - anchorY;
    const rdxA = dxA * cosNeg - dy * sinNeg;
    const rdy = dxA * sinNeg + dy * cosNeg;
    const lu = rdxA * ux + rdy * uy;
    const lv = rdxA * vx + rdy * vy;
    // Map upper inner lip (lv=0) to v=0.05 and lower inner lip (lv=currentLipGap) to v=0.78
    // so upper teeth (v=0.05..0.50) are always cleanly visible when speaking/smiling!
    const mu = 0.5 + lu / (face.mouthW * 0.92);
    const mv = 0.05 + (lv / currentLipGap) * 0.73;
    return [mu, mv];
  };

  mouthPosBuf[0] = mCenterX;
  mouthPosBuf[1] = mCenterY;
  if (face.hasVisibleTeeth) {
    const [ru, rv, dm] = mapRealPhotoMouth(mCenterX, mCenterY);
    mouthUvBuf[0] = ru;
    mouthUvBuf[1] = rv;
    mouthMaskBuf[0] = dm;
  } else {
    const [cu, cv] = mapSynthMouth(mCenterX, mCenterY);
    mouthUvBuf[0] = cu;
    mouthUvBuf[1] = cv;
    mouthMaskBuf[0] = 0.5;
  }

  for (let i = 0; i < INNER_LIP_LOOP.length; i++) {
    const lIdx = INNER_LIP_LOOP[i]!;
    const px = posBuf[lIdx * 2]!;
    const py = posBuf[lIdx * 2 + 1]!;
    const ex = px + (px - mCenterX) * 0.14;
    const ey = py + (py - mCenterY) * 0.14;
    mouthPosBuf[(1 + i) * 2] = ex;
    mouthPosBuf[(1 + i) * 2 + 1] = ey;
    if (face.hasVisibleTeeth) {
      const [ru, rv, dm] = mapRealPhotoMouth(ex, ey);
      mouthUvBuf[(1 + i) * 2] = ru;
      mouthUvBuf[(1 + i) * 2 + 1] = rv;
      mouthMaskBuf[1 + i] = dm;
    } else {
      const [mu, mv] = mapSynthMouth(ex, ey);
      mouthUvBuf[(1 + i) * 2] = mu;
      mouthUvBuf[(1 + i) * 2 + 1] = mv;
      mouthMaskBuf[1 + i] = 0.5;
    }
  }

  // 6) Aligned Eyeball behind eyelids with micro-gaze saccades (zero black gap around eyes!)
  const { eyePosBuf, eyeUvBuf } = rig;
  const fillEyeFan = (loop: number[], offset: number) => {
    const len = loop.length;
    let bsx = 0;
    let bsy = 0;
    const restTransformed: Array<[number, number]> = new Array(len);

    for (let i = 0; i < len; i++) {
      const idx = loop[i]!;
      const bu = baseUv[idx * 2]!;
      const bv = baseUv[idx * 2 + 1]!;
      bsx += bu;
      bsy += bv;
      const [pdxA, pdy] = computeParallax(bu, bv, baseZ[idx]!);
      restTransformed[i] = applyHeadNeckTransform(bu + pdxA / aspect, bv + pdy, 1.0);
    }

    let sx = 0;
    let sy = 0;
    for (let i = 0; i < len; i++) {
      sx += restTransformed[i]![0];
      sy += restTransformed[i]![1];
    }

    const cx = sx / len;
    const cy = sy / len;
    const bcx = bsx / len;
    const bcy = bsy / len;

    // Subtle iris gaze micro-movement clamped safely inside the eyeball texture
    const gx = (-expr.gazeX * face.faceW * 0.012) / aspect;
    const gy = -expr.gazeY * face.faceH * 0.008;

    eyePosBuf[offset * 2] = cx;
    eyePosBuf[offset * 2 + 1] = cy;
    eyeUvBuf[offset * 2] = bcx + gx;
    eyeUvBuf[offset * 2 + 1] = bcy + gy;

    const outerStart = offset + 1;
    for (let i = 0; i < len; i++) {
      const idx = loop[i]!;
      const [px, py] = restTransformed[i]!;
      const bu = baseUv[idx * 2]!;
      const bv = baseUv[idx * 2 + 1]!;
      // Expand geometry behind the face hole by 1.18x so zero background gap ever shows through
      eyePosBuf[(outerStart + i) * 2] = cx + (px - cx) * 1.18;
      eyePosBuf[(outerStart + i) * 2 + 1] = cy + (py - cy) * 1.18;
      eyeUvBuf[(outerStart + i) * 2] = bcx + (bu - bcx) * 1.08 + gx * 0.25;
      eyeUvBuf[(outerStart + i) * 2 + 1] = bcy + (bv - bcy) * 1.08 + gy * 0.25;
    }
  };
  fillEyeFan(RIGHT_EYE_LOOP, 0);
  fillEyeFan(LEFT_EYE_LOOP, 1 + RIGHT_EYE_LOOP.length);
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

    const rig = face ? buildFaceRig(face) : null;

    const quadPos = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    const quadUv = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    const quadMask = new Float32Array([0, 0, 0, 0]);
    const quadIdx = new Uint16Array([0, 2, 1, 1, 2, 3]);

    const posVbo = gl.createBuffer();
    const uvVbo = gl.createBuffer();
    const maskVbo = gl.createBuffer();
    const ibo = gl.createBuffer();

    const aPos = gl.getAttribLocation(prog, "aPos");
    const aUv = gl.getAttribLocation(prog, "aUv");
    const aMask = gl.getAttribLocation(prog, "aMask");

    const uploadPhotoTex = () => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      return tex;
    };

    const uploadMouthTex = () => {
      const colors: FaceColors = face?.colors ?? {
        skin: [215, 175, 155],
        lip: [165, 92, 92],
        eyelid: [195, 155, 138],
        enamel: [236, 232, 224],
        shirt: [240, 240, 240],
      };
      const mouthCanvas = createMouthCanvas(colors);
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mouthCanvas);
      return tex;
    };

    const photoTex = uploadPhotoTex();
    const mouthTex = uploadMouthTex();

    gl.uniform1i(gl.getUniformLocation(prog, "uPhotoTex"), 0);
    gl.uniform1i(gl.getUniformLocation(prog, "uMouthTex"), 1);

    const uScale = gl.getUniformLocation(prog, "uScale");
    const uPivot = gl.getUniformLocation(prog, "uPivot");
    const uTilt = gl.getUniformLocation(prog, "uTilt");
    const uZoom = gl.getUniformLocation(prog, "uZoom");
    const uOffset = gl.getUniformLocation(prog, "uOffset");
    const uImgAspect = gl.getUniformLocation(prog, "uImgAspect");
    const uMode = gl.getUniformLocation(prog, "uMode");
    const uBlink = gl.getUniformLocation(prog, "uBlink");
    const uOpen = gl.getUniformLocation(prog, "uOpen");
    const uEyelidColor = gl.getUniformLocation(prog, "uEyelidColor");

    const imgW = img.naturalWidth || img.width || 512;
    const imgH = img.naturalHeight || img.height || 512;
    gl.uniform1f(uImgAspect, imgW / imgH);

    if (face) {
      const [er, eg, eb] = face.colors.eyelid;
      gl.uniform3f(uEyelidColor, er / 255, eg / 255, eb / 255);
    } else {
      gl.uniform3f(uEyelidColor, 0.76, 0.61, 0.54);
    }

    let raf = 0;
    let lastNow = performance.now();
    let nextBlink = lastNow + 1200;
    let blinkProgress = 1;
    let nextGazeAt = lastNow + 1600;
    let targetGazeX = 0;
    let targetGazeY = 0;
    let smoothGazeX = 0;
    let smoothGazeY = 0;

    let smoothOpen = 0;
    let smoothWide = 0;
    let smoothRound = 0;
    let smoothInnerBrowY = 0;
    let smoothInnerBrowPinch = 0;
    let smoothOuterBrowY = 0;
    let smoothSquint = 0;
    let smoothEyeWide = 0;
    let smoothCheekLift = 0;
    let smoothSmile = face?.hasVisibleTeeth ? 0 : 0.05;
    let smoothYaw = 0;

    const zeroMaskEye = rig ? new Float32Array(rig.eyeVertCount) : null;

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
      gl.clearColor(0.06, 0.08, 0.12, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const em = emotionRef.current;
      const isActive = activeRef.current;
      const v = isActive ? audioVisemes() : { level: 0, open: 0, wide: 0, round: 0 };

      // Emotion targets (drive authentic brow, eye, cheek, mouth & posture expressions)
      let emOpen = 0;
      let emWide = 0;
      let emRound = 0;
      let emInnerBrowY = 0.04 * Math.sin(t * 0.8);
      let emInnerBrowPinch = 0;
      let emOuterBrowY = 0.05 * Math.sin(t * 0.8);
      let emSquint = 0;
      let emEyeWide = 0;
      let emCheekLift = 0;
      let emSmile = face?.hasVisibleTeeth ? 0 : 0.05;

      if (em === "happy") {
        emSmile = face?.hasVisibleTeeth ? 0.28 : 0.56;
        emCheekLift = 0.55;
        emSquint = 0.24;
        emInnerBrowY = 0.22;
        emOuterBrowY = 0.28;
        emOpen = isActive ? 0 : 0.14;
      } else if (em === "laugh") {
        const chuckle = 0.5 + 0.5 * Math.sin(t * 14.5);
        emSmile = face?.hasVisibleTeeth ? 0.42 : 0.78;
        emWide = 0.35;
        emCheekLift = 0.85;
        emSquint = 0.42;
        emInnerBrowY = 0.34;
        emOuterBrowY = 0.42;
        emOpen = isActive ? 0.25 + chuckle * 0.35 : 0.32 + chuckle * 0.38;
      } else if (em === "angry") {
        emInnerBrowY = -0.82;
        emInnerBrowPinch = 0.85;
        emOuterBrowY = -0.2;
        emSquint = 0.42;
        emSmile = -0.38;
        emOpen = isActive ? 0 : 0.05;
      } else if (em === "surprised") {
        emInnerBrowY = 0.85;
        emOuterBrowY = 0.92;
        emEyeWide = 0.28;
        emRound = 0.34;
        emOpen = isActive ? 0 : 0.28;
      } else if (em === "sad") {
        emInnerBrowY = 0.46;
        emOuterBrowY = -0.28;
        emSmile = -0.32;
        emSquint = 0.12;
      }

      const speechOpen = isActive ? Math.min(1, v.open * 0.96) : 0;
      const targetOpen = Math.max(speechOpen, emOpen);
      const targetWide = isActive ? Math.max(v.wide, emWide) : emWide;
      const targetRound = isActive ? Math.max(v.round, emRound) : emRound;

      smoothOpen += (targetOpen - smoothOpen) * (targetOpen > smoothOpen ? 0.44 : 0.22);
      smoothWide += (targetWide - smoothWide) * 0.22;
      smoothRound += (targetRound - smoothRound) * 0.22;

      const speakBrowBoost = isActive ? 0.16 + smoothOpen * 0.35 : 0;
      const targetInnerBrowY = em === "angry" ? emInnerBrowY : emInnerBrowY + speakBrowBoost;
      const targetOuterBrowY = emOuterBrowY + speakBrowBoost;

      smoothInnerBrowY += (targetInnerBrowY - smoothInnerBrowY) * 0.14;
      smoothInnerBrowPinch += (emInnerBrowPinch - smoothInnerBrowPinch) * 0.14;
      smoothOuterBrowY += (targetOuterBrowY - smoothOuterBrowY) * 0.14;
      smoothSquint += (emSquint - smoothSquint) * 0.14;
      smoothEyeWide += (emEyeWide - smoothEyeWide) * 0.14;
      smoothCheekLift += (emCheekLift - smoothCheekLift) * 0.12;
      smoothSmile += (emSmile + (isActive ? 0.06 : 0) - smoothSmile) * 0.12;

      // Micro eye-gaze saccades (lock toward camera when talking, glance naturally when idle)
      if (now >= nextGazeAt) {
        if (isActive || em === "angry") {
          targetGazeX = (Math.random() - 0.5) * 0.22;
          targetGazeY = (Math.random() - 0.5) * 0.15;
          nextGazeAt = now + 1100 + Math.random() * 1400;
        } else {
          targetGazeX = (Math.random() - 0.5) * 0.72;
          targetGazeY = (Math.random() - 0.5) * 0.45;
          nextGazeAt = now + 1600 + Math.random() * 2400;
        }
      }
      smoothGazeX += (targetGazeX - smoothGazeX) * 0.14;
      smoothGazeY += (targetGazeY - smoothGazeY) * 0.14;

      const yawIntensity = em === "angry" ? 0.18 : em === "laugh" ? 0.22 : 0.14;
      const targetYaw =
        Math.sin(t * 0.65) * yawIntensity +
        (isActive ? Math.sin(t * 1.65) * 0.13 * (0.35 + smoothOpen) : 0);
      smoothYaw += (targetYaw - smoothYaw) * 0.09;

      if (now >= nextBlink) {
        blinkProgress = 0;
        const doubleBlink = Math.random() < 0.2;
        const baseInterval = em === "sad" ? 3300 : em === "surprised" ? 4200 : 2500;
        nextBlink = now + (doubleBlink ? 300 : baseInterval + Math.random() * 2400);
      }
      if (blinkProgress < 1) {
        blinkProgress = Math.min(1, blinkProgress + dt / 0.18);
      }
      const blinkCurve = blinkProgress < 1 ? Math.sin(blinkProgress * Math.PI) : 0;

      const sc = Math.max(W / imgW, H / imgH);
      const sx = (imgW * sc) / W;
      const sy = (imgH * sc) / H;

      const pivot = face ? face.center : [0.5, 0.45];

      if (rig && face) {
        const laughBob = em === "laugh" ? Math.sin(t * 14.5) * 0.022 * face.faceH : 0;
        const angryNod = em === "angry" ? Math.sin(t * 4.5) * 0.015 * face.faceH : 0;
        const headRoll =
          Math.sin(t * 0.72) * 0.052 +
          (em === "angry" ? -0.045 + Math.sin(t * 3.8) * 0.02 : 0) +
          (em === "laugh" ? Math.sin(t * 7.2) * 0.035 : 0) +
          (em === "sad" ? 0.055 : 0) +
          (isActive ? Math.sin(t * 1.65) * 0.045 * (0.35 + smoothOpen) : 0);
        const headDx =
          (Math.sin(t * 0.54) * 0.02 + (isActive ? Math.sin(t * 1.4) * 0.015 * smoothOpen : 0)) *
          face.faceW;
        const headDy =
          (Math.sin(t * 1.15) * 0.016 +
            (em === "surprised" ? -0.025 : 0) +
            (em === "sad" ? 0.022 : 0) -
            (isActive ? Math.sin(t * 2.5) * 0.024 * (0.25 + smoothOpen) : 0)) *
            face.faceH -
          laughBob +
          angryNod;
        const torsoBreath =
          Math.sin(t * 1.55) * 0.25 + (em === "laugh" ? Math.sin(t * 14.5) * 0.45 : 0);

        deformFaceRig(rig, face, {
          blink: blinkCurve,
          open: smoothOpen,
          wide: smoothWide,
          round: smoothRound,
          innerBrowY: smoothInnerBrowY,
          innerBrowPinch: smoothInnerBrowPinch,
          outerBrowY: smoothOuterBrowY,
          eyeSquint: smoothSquint,
          eyeWide: smoothEyeWide,
          cheekLift: smoothCheekLift,
          smile: smoothSmile,
          gazeX: smoothGazeX,
          gazeY: smoothGazeY,
          yawWave: smoothYaw,
          headRoll,
          headDx,
          headDy,
          torsoBreath,
        });

        const emZoom = em === "angry" ? 0.024 : em === "surprised" ? -0.018 : 0;
        gl.uniform2f(uScale, sx, sy);
        gl.uniform2f(uPivot, pivot[0]!, pivot[1]!);
        gl.uniform1f(uTilt, 0);
        gl.uniform1f(uZoom, 1.02 + emZoom + Math.sin(t * 1.25) * 0.006);
        gl.uniform2f(uOffset, 0, 0);
        gl.uniform1f(uBlink, blinkCurve);
        gl.uniform1f(uOpen, smoothOpen);

        drawGeometry(
          face.hasVisibleTeeth ? 3 : 1,
          rig.mouthPosBuf,
          rig.mouthUvBuf,
          rig.mouthMaskBuf,
          rig.mouthIndices,
        );

        drawGeometry(2, rig.eyePosBuf, rig.eyeUvBuf, zeroMaskEye!, rig.eyeIndices);

        drawGeometry(0, rig.posBuf, rig.uvBuf, rig.maskBuf, rig.photoIndices);
      } else {
        gl.uniform2f(uScale, sx, sy);
        gl.uniform2f(uPivot, pivot[0]!, pivot[1]!);
        gl.uniform1f(uTilt, Math.sin(t * 0.8) * 0.024);
        gl.uniform1f(uZoom, 1.02 + Math.sin(t * 1.3) * 0.006 + smoothOpen * 0.01);
        gl.uniform2f(uOffset, Math.sin(t * 0.6) * 0.008, Math.sin(t * 1.3) * 0.008);
        gl.uniform1f(uBlink, blinkCurve);
        gl.uniform1f(uOpen, smoothOpen);
        drawGeometry(0, quadPos, quadUv, quadMask, quadIdx);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      gl.deleteTexture(photoTex);
      gl.deleteTexture(mouthTex);
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
    let smoothOpen = 0;

    const draw = (now: number) => {
      const rect = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(1, Math.round(rect.width * dpr));
      const H = Math.max(1, Math.round(rect.height * dpr));
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }

      const raw = activeRef.current ? audioVisemes().open : 0;
      smoothOpen += (raw - smoothOpen) * 0.34;

      ctx.save();
      ctx.clearRect(0, 0, W, H);
      if (img) {
        const sc = Math.max(W / img.width, H / img.height);
        const dw = img.width * sc;
        const dh = img.height * sc;
        const t = now * 0.001;
        ctx.translate(W / 2, H / 2);
        ctx.rotate(Math.sin(t * 0.8) * 0.016);
        ctx.scale(1.02 + smoothOpen * 0.01, 1.02 + smoothOpen * 0.01);
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      }
      ctx.restore();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [img, useCanvasFallback]);

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
    <div className={`relative overflow-hidden ${className}`}>
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
