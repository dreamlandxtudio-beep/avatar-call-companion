// Face (478 iris), Pose (33 body), Hand (21x2), and Selfie Segmentation with Google MediaPipe + pixel-level eye/teeth/color analysis.
import { fitCanonicalLandmarks, type FaceKeypoints } from "./canonicalFace";

export type Axis2D = {
  ux: number; // unit vector along left->right feature in aspect-corrected space
  uy: number;
  vx: number; // unit vector pointing "downward" relative to the tilted feature
  vy: number;
};

export type IrisInfo = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
};

export type FaceColors = {
  skin: [number, number, number];
  lip: [number, number, number];
  eyelid: [number, number, number];
  enamel: [number, number, number];
  shirt: [number, number, number];
  sclera: [number, number, number];
  iris: [number, number, number];
};

export type FacePts = {
  /** All 468 or 478 normalized [x, y, z] landmarks */
  landmarks: Array<[number, number, number]>;
  /** Image aspect ratio (width / height) used for angle-accurate deformation */
  aspect: number;
  /** Canonical 854-triangle face mesh index buffer over landmarks 0..467 */
  faceTris: Uint16Array;
  /** Ordered 36-vertex perimeter loop around the face oval */
  ovalLoop: number[];
  /** Pivot center (nose bridge / mid face) */
  center: [number, number];
  /** Left-to-right eye & mouth local tilted axes */
  faceAxis: Axis2D;
  mouthAxis: Axis2D;
  leftEyeAxis: Axis2D;
  rightEyeAxis: Axis2D;
  /** Exact iris center & radii (from 478 iris landmarks or eye loop fallback) */
  rightIris: IrisInfo;
  leftIris: IrisInfo;
  /** Normalized face dimensions in aspect-corrected space */
  faceW: number;
  faceH: number;
  mouthW: number;
  jawSpan: number;
  /** Ratio of inner lip separation to mouth width in the original photo */
  restMouthRatio: number;
  /** True when pixels inside the inner lip polygon show real teeth */
  hasVisibleTeeth: boolean;
  /** True when mouth is visibly parted (either teeth or dark oral cavity) */
  isMouthParted: boolean;
  /** Vertical extent (in UV space) of visible upper teeth in resting photo */
  restTeethDepth: number;
  /** Approximate horizontal yaw (-0.6..0.6) for 3/4 perspective */
  yaw: number;
  /** Photo-sampled colors for seamless teeth, cavity, eyelid, sclera & iris blending */
  colors: FaceColors;
  /** 33 full-body pose landmarks [x, y, z, visibility] when detected */
  poseLandmarks: Array<[number, number, number, number]> | null;
  /** Detected 21-point hand landmarks (up to 2 hands) when hands are visible in frame */
  handLandmarks: Array<Array<[number, number, number]>>;
  /** Soft person foreground silhouette alpha mask (white=person, black=background) */
  fgMaskCanvas: HTMLCanvasElement | null;
  /** Clean background-only canvas with foreground silhouette smoothly inpainted */
  bgCanvas: HTMLCanvasElement | null;
};

// Ordered anatomical loops (matching MediaPipe FaceMesh topology)
export const INNER_UPPER_LIP = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
export const INNER_LOWER_LIP = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
export const INNER_LIP_LOOP = [
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95,
];

export const OUTER_UPPER_LIP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291];
export const OUTER_LOWER_LIP = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];

export const RIGHT_EYE_UPPER = [33, 246, 161, 160, 159, 158, 157, 173, 133];
export const RIGHT_EYE_LOWER = [33, 7, 163, 144, 145, 153, 154, 155, 133];
export const LEFT_EYE_UPPER = [362, 398, 384, 385, 386, 387, 388, 466, 263];
export const LEFT_EYE_LOWER = [362, 382, 381, 380, 374, 373, 390, 249, 263];

export const RIGHT_EYE_LOOP = [
  33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7,
];
export const LEFT_EYE_LOOP = [
  362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382,
];

const cache = new Map<string, FacePts | null>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lm: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fd: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let poseLm: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handLm: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let segLm: any = null;
let cachedFaceTris: Uint16Array | null = null;
let cachedOvalLoop: number[] | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCanonicalTopology(FaceLandmarkerCls: any) {
  if (!cachedFaceTris) {
    const adj = new Map<number, Set<number>>();
    const edges = FaceLandmarkerCls.FACE_LANDMARKS_TESSELATION as Array<{
      start: number;
      end: number;
    }>;
    for (const { start, end } of edges) {
      if (!adj.has(start)) adj.set(start, new Set());
      if (!adj.has(end)) adj.set(end, new Set());
      adj.get(start)!.add(end);
      adj.get(end)!.add(start);
    }
    const tris: number[] = [];
    for (const [u, nu] of adj) {
      for (const v of nu) {
        if (v <= u) continue;
        const nv = adj.get(v)!;
        for (const w of nu) {
          if (w <= v) continue;
          if (nv.has(w)) tris.push(u, v, w);
        }
      }
    }
    cachedFaceTris = new Uint16Array(tris);
  }
  if (!cachedOvalLoop) {
    const ovalEdges = FaceLandmarkerCls.FACE_LANDMARKS_FACE_OVAL as Array<{
      start: number;
      end: number;
    }>;
    cachedOvalLoop = ovalEdges.map((e) => e.start);
  }
  return { faceTris: cachedFaceTris, ovalLoop: cachedOvalLoop };
}

function makeAxis(ax: number, ay: number, bx: number, by: number, aspect: number): Axis2D {
  const dx = (bx - ax) * aspect;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  let vx = -uy;
  let vy = ux;
  if (vy < 0) {
    vx = -vx;
    vy = -vy;
  }
  return { ux, uy, vx, vy };
}

function pointInPoly(px: number, py: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]![0];
    const yi = poly[i]![1];
    const xj = poly[j]![0];
    const yj = poly[j]![1];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function extractIris(
  pts: Array<[number, number, number]>,
  centerIdx: number,
  ringIndices: number[],
  fallbackLoop: number[],
): IrisInfo {
  if (pts.length >= 478 && pts[centerIdx]) {
    const c = pts[centerIdx]!;
    let rxSum = 0;
    let rySum = 0;
    for (const idx of ringIndices) {
      const p = pts[idx];
      if (!p) continue;
      rxSum = Math.max(rxSum, Math.abs(p[0] - c[0]));
      rySum = Math.max(rySum, Math.abs(p[1] - c[1]));
    }
    if (rxSum > 0.002 && rySum > 0.002) {
      return { cx: c[0], cy: c[1], rx: rxSum, ry: rySum };
    }
  }
  // Estimate iris center/radius cleanly from eye loop
  let sx = 0;
  let sy = 0;
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const idx of fallbackLoop) {
    const p = pts[idx]!;
    sx += p[0];
    sy += p[1];
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return {
    cx: sx / fallbackLoop.length,
    cy: sy / fallbackLoop.length,
    rx: Math.max(0.008, (maxX - minX) * 0.27),
    ry: Math.max(0.008, (maxY - minY) * 0.44),
  };
}

type MouthAnalysis = {
  colors: FaceColors;
  hasVisibleTeeth: boolean;
  isMouthParted: boolean;
  restTeethDepth: number;
};

function analyzePhotoFeatures(
  img: HTMLImageElement,
  pts: Array<[number, number, number]>,
  restMouthRatio: number,
  rightIris: IrisInfo,
  leftIris: IrisInfo,
): MouthAnalysis {
  const fallback: FaceColors = {
    skin: [215, 175, 155],
    lip: [165, 92, 92],
    eyelid: [195, 155, 138],
    enamel: [236, 232, 224],
    shirt: [45, 68, 88],
    sclera: [236, 234, 230],
    iris: [108, 82, 56],
  };

  try {
    const S = 224;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return {
        colors: fallback,
        hasVisibleTeeth: restMouthRatio > 0.08,
        isMouthParted: restMouthRatio > 0.08,
        restTeethDepth: Math.abs(pts[14]![1] - pts[13]![1]),
      };
    }
    ctx.drawImage(img, 0, 0, S, S);
    const data = ctx.getImageData(0, 0, S, S).data;

    const avgAt = (indices: number[]): [number, number, number] => {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (const idx of indices) {
        const pt = pts[idx];
        if (!pt) continue;
        const px = Math.min(S - 1, Math.max(0, Math.round(pt[0] * (S - 1))));
        const py = Math.min(S - 1, Math.max(0, Math.round(pt[1] * (S - 1))));
        const off = (py * S + px) * 4;
        r += data[off]!;
        g += data[off + 1]!;
        b += data[off + 2]!;
        n++;
      }
      return n > 0 ? [r / n, g / n, b / n] : fallback.skin;
    };

    const sampleUV = (u: number, v: number): [number, number, number] => {
      const px = Math.min(S - 1, Math.max(0, Math.round(u * (S - 1))));
      const py = Math.min(S - 1, Math.max(0, Math.round(v * (S - 1))));
      const off = (py * S + px) * 4;
      return [data[off]!, data[off + 1]!, data[off + 2]!];
    };

    const skin = avgAt([118, 347, 50, 280, 195]);
    const lip = avgAt([0, 17, 37, 267, 84, 314]);
    const eyelid = avgAt([29, 30, 259, 260, 27, 257]);
    const forehead = avgAt([10, 151, 9]);

    // Sample real iris color (halfway between center and iris outer rim)
    const irisSamples: Array<[number, number, number]> = [
      sampleUV(rightIris.cx + rightIris.rx * 0.52, rightIris.cy),
      sampleUV(rightIris.cx - rightIris.rx * 0.52, rightIris.cy),
      sampleUV(leftIris.cx + leftIris.rx * 0.52, leftIris.cy),
      sampleUV(leftIris.cx - leftIris.rx * 0.52, leftIris.cy),
    ];
    let irR = 0;
    let irG = 0;
    let irB = 0;
    for (const s of irisSamples) {
      irR += s[0];
      irG += s[1];
      irB += s[2];
    }
    const iris: [number, number, number] = [
      Math.max(45, irR / irisSamples.length),
      Math.max(38, irG / irisSamples.length),
      Math.max(32, irB / irisSamples.length),
    ];

    // Sample real sclera (white of eye between iris and inner/outer corners)
    const scSamples: Array<[number, number, number]> = [
      sampleUV(
        (pts[133]![0] + rightIris.cx - rightIris.rx) * 0.5,
        (pts[133]![1] + rightIris.cy) * 0.5,
      ),
      sampleUV(
        (pts[362]![0] + leftIris.cx - leftIris.rx) * 0.5,
        (pts[362]![1] + leftIris.cy) * 0.5,
      ),
    ];
    const rawSc: [number, number, number] = [
      (scSamples[0]![0] + scSamples[1]![0]) * 0.5,
      (scSamples[0]![1] + scSamples[1]![1]) * 0.5,
      (scSamples[0]![2] + scSamples[1]![2]) * 0.5,
    ];
    const scLuma = rawSc[0] * 0.299 + rawSc[1] * 0.587 + rawSc[2] * 0.114;
    const scBoost = scLuma < 190 ? 215 / Math.max(90, scLuma) : 1;
    const sclera: [number, number, number] = [
      Math.min(246, Math.round(rawSc[0] * scBoost)),
      Math.min(244, Math.round(rawSc[1] * scBoost)),
      Math.min(242, Math.round(rawSc[2] * scBoost)),
    ];

    let shirtR = 0;
    let shirtG = 0;
    let shirtB = 0;
    let shirtN = 0;
    for (let py = Math.round(S * 0.78); py < S; py += 4) {
      for (let px = Math.round(S * 0.25); px < Math.round(S * 0.75); px += 4) {
        const off = (py * S + px) * 4;
        shirtR += data[off]!;
        shirtG += data[off + 1]!;
        shirtB += data[off + 2]!;
        shirtN++;
      }
    }
    const shirt: [number, number, number] =
      shirtN > 0 ? [shirtR / shirtN, shirtG / shirtN, shirtB / shirtN] : [45, 68, 88];

    // High-resolution crop strictly around the mouth ROI to inspect pixels inside INNER_LIP_LOOP
    const imgW = img.naturalWidth || img.width || 512;
    const imgH = img.naturalHeight || img.height || 512;
    let minX = 1;
    let maxX = 0;
    let minY = 1;
    let maxY = 0;
    for (const idx of INNER_LIP_LOOP) {
      const pt = pts[idx]!;
      if (pt[0] < minX) minX = pt[0];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[1] > maxY) maxY = pt[1];
    }

    const padX = Math.max(0.015, (maxX - minX) * 0.2);
    const padY = Math.max(0.015, (maxY - minY) * 0.35);
    const rx0 = Math.max(0, minX - padX);
    const ry0 = Math.max(0, minY - padY);
    const rw = Math.max(0.02, Math.min(1 - rx0, maxX - minX + padX * 2));
    const rh = Math.max(0.02, Math.min(1 - ry0, maxY - minY + padY * 2));

    const MW = 96;
    const MH = 48;
    const mc = document.createElement("canvas");
    mc.width = MW;
    mc.height = MH;
    const mctx = mc.getContext("2d", { willReadFrequently: true });

    let hasVisibleTeeth = false;
    let isMouthParted = restMouthRatio > 0.085;
    let teethR = 0;
    let teethG = 0;
    let teethB = 0;
    let teethCount = 0;
    let maxTeethNormY = 0;

    if (mctx) {
      mctx.drawImage(img, rx0 * imgW, ry0 * imgH, rw * imgW, rh * imgH, 0, 0, MW, MH);
      const mData = mctx.getImageData(0, 0, MW, MH).data;
      const poly: Array<[number, number]> = INNER_LIP_LOOP.map((idx) => [
        ((pts[idx]![0] - rx0) / rw) * MW,
        ((pts[idx]![1] - ry0) / rh) * MH,
      ]);

      const lipLuma = lip[0] * 0.299 + lip[1] * 0.587 + lip[2] * 0.114;
      let insideCount = 0;
      let darkCavityCount = 0;

      for (let y = 0; y < MH; y++) {
        for (let x = 0; x < MW; x++) {
          if (!pointInPoly(x + 0.5, y + 0.5, poly)) continue;
          insideCount++;
          const off = (y * MW + x) * 4;
          const r = mData[off]!;
          const g = mData[off + 1]!;
          const b = mData[off + 2]!;
          const luma = 0.299 * r + 0.587 * g + 0.114 * b;
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
          const redness = r - (g + b) * 0.5;

          if (luma > Math.max(118, lipLuma * 1.1) && sat < 0.34 && redness < 30) {
            teethCount++;
            teethR += r;
            teethG += g;
            teethB += b;
            const normY = (y / MH) * rh + ry0 - pts[13]![1];
            if (normY > maxTeethNormY) maxTeethNormY = normY;
          } else if (luma < lipLuma * 0.58) {
            darkCavityCount++;
          }
        }
      }

      const teethFrac = insideCount > 0 ? teethCount / insideCount : 0;
      const cavityFrac = insideCount > 0 ? darkCavityCount / insideCount : 0;
      hasVisibleTeeth = teethCount >= 20 || teethFrac >= 0.15;
      isMouthParted = hasVisibleTeeth || cavityFrac >= 0.2 || restMouthRatio > 0.095;
    }

    const skinLuma =
      (skin[0] * 0.299 +
        skin[1] * 0.587 +
        skin[2] * 0.114 +
        forehead[0] * 0.299 +
        forehead[1] * 0.587 +
        forehead[2] * 0.114) /
      2;
    const scale = Math.min(0.98, Math.max(0.76, 0.72 + (skinLuma / 255) * 0.28));
    const sampledEnamel: [number, number, number] =
      hasVisibleTeeth && teethCount > 0
        ? [teethR / teethCount, teethG / teethCount, teethB / teethCount]
        : [
            Math.min(244, Math.round(236 * scale + (skin[0] - skin[2]) * 0.06)),
            Math.min(240, Math.round(232 * scale + (skin[1] - skin[2]) * 0.04)),
            Math.min(234, Math.round(224 * scale)),
          ];
    const enamelLuma =
      sampledEnamel[0] * 0.299 + sampledEnamel[1] * 0.587 + sampledEnamel[2] * 0.114;
    const boost = enamelLuma < 205 ? 210 / Math.max(80, enamelLuma) : 1;
    const enamel: [number, number, number] = [
      Math.min(248, Math.round(sampledEnamel[0] * boost)),
      Math.min(244, Math.round(sampledEnamel[1] * boost)),
      Math.min(238, Math.round(sampledEnamel[2] * boost)),
    ];

    const lipGapY = Math.max(0.01, Math.abs(pts[14]![1] - pts[13]![1]));
    const restTeethDepth = Math.max(lipGapY, maxTeethNormY);

    return {
      colors: { skin, lip, eyelid, enamel, shirt, sclera, iris },
      hasVisibleTeeth,
      isMouthParted,
      restTeethDepth,
    };
  } catch {
    return {
      colors: fallback,
      hasVisibleTeeth: restMouthRatio > 0.08,
      isMouthParted: restMouthRatio > 0.08,
      restTeethDepth: Math.abs(pts[14]![1] - pts[13]![1]),
    };
  }
}

/**
 * Separates foreground person silhouette into a soft alpha mask canvas and
 * builds a clean background canvas with the foreground cleanly inpainted inward
 * so background walls/windows NEVER stretch when the head, hair, torso, or hands move.
 */
function buildForegroundAndBackground(
  img: HTMLImageElement,
  mask: Float32Array,
  mw: number,
  mh: number,
): { fgMaskCanvas: HTMLCanvasElement; bgCanvas: HTMLCanvasElement } {
  const fgRaw = document.createElement("canvas");
  fgRaw.width = mw;
  fgRaw.height = mh;
  const fctx = fgRaw.getContext("2d")!;
  const fImg = fctx.createImageData(mw, mh);
  const fData = fImg.data;
  for (let i = 0; i < mw * mh; i++) {
    const m = Math.min(1, Math.max(0, mask[i] ?? 0));
    // Smooth soft threshold so hair edges blend naturally without halo
    const alpha = Math.round(Math.min(1, Math.max(0, (m - 0.18) / 0.6)) * 255);
    const o = i * 4;
    fData[o] = alpha;
    fData[o + 1] = alpha;
    fData[o + 2] = alpha;
    fData[o + 3] = 255;
  }
  fctx.putImageData(fImg, 0, 0);

  // Feathered 224x224 mask canvas
  const W = 224;
  const H = 224;
  const fgMaskCanvas = document.createElement("canvas");
  fgMaskCanvas.width = W;
  fgMaskCanvas.height = H;
  const fmCtx = fgMaskCanvas.getContext("2d")!;
  fmCtx.filter = "blur(1.6px)";
  fmCtx.drawImage(fgRaw, 0, 0, W, H);
  fmCtx.filter = "none";

  // Build inpainted background canvas (fill inside foreground silhouette from nearest clean bg pixels)
  const bgCanvas = document.createElement("canvas");
  bgCanvas.width = W;
  bgCanvas.height = H;
  const bCtx = bgCanvas.getContext("2d", { willReadFrequently: true })!;
  bCtx.drawImage(img, 0, 0, W, H);
  const bgData = bCtx.getImageData(0, 0, W, H);
  const fmData = fmCtx.getImageData(0, 0, W, H).data;
  const px = bgData.data;

  // Track which pixels belong to clean background (valid=1) vs person foreground (valid=0)
  const valid = new Uint8Array(W * H);
  const curR = new Float32Array(W * H);
  const curG = new Float32Array(W * H);
  const curB = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    curR[i] = px[o]!;
    curG[i] = px[o + 1]!;
    curB[i] = px[o + 2]!;
    valid[i] = fmData[o]! < 85 ? 1 : 0;
  }

  // Multi-pass 8-neighbor inward push-pull fill so head/torso silhouette is cleanly replaced by room/street bg
  const nextValid = new Uint8Array(valid);
  const nextR = new Float32Array(curR);
  const nextG = new Float32Array(curG);
  const nextB = new Float32Array(curB);

  for (let pass = 0; pass < 36; pass++) {
    let changed = false;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (valid[idx] === 1) continue;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let cnt = 0;
        for (let dy = -2; dy <= 2; dy += 2) {
          const ny = y + dy;
          if (ny < 0 || ny >= H) continue;
          for (let dx = -2; dx <= 2; dx += 2) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= W) continue;
            const nIdx = ny * W + nx;
            if (valid[nIdx] === 1) {
              sr += curR[nIdx]!;
              sg += curG[nIdx]!;
              sb += curB[nIdx]!;
              cnt++;
            }
          }
        }
        if (cnt > 0) {
          nextR[idx] = sr / cnt;
          nextG[idx] = sg / cnt;
          nextB[idx] = sb / cnt;
          nextValid[idx] = 1;
          changed = true;
        }
      }
    }
    valid.set(nextValid);
    curR.set(nextR);
    curG.set(nextG);
    curB.set(nextB);
    if (!changed) break;
  }

  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    px[o] = Math.round(curR[i]!);
    px[o + 1] = Math.round(curG[i]!);
    px[o + 2] = Math.round(curB[i]!);
  }
  bCtx.putImageData(bgData, 0, 0);

  return { fgMaskCanvas, bgCanvas };
}

let tfliteFilterInstalled = false;
function installTfliteConsoleFilter() {
  if (tfliteFilterInstalled || typeof window === "undefined") return;
  tfliteFilterInstalled = true;
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (
      /^INFO:\s/i.test(first) ||
      /Created TensorFlow Lite XNNPACK delegate/i.test(first) ||
      /^I\d{4}\s+.*(tflite|xnnpack|mediapipe|face_landmarker|face_detector|pose_landmarker|hand_landmarker|image_segmenter)/i.test(
        first,
      )
    ) {
      console.info(...args);
      return;
    }
    origError(...args);
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let visionPromise: Promise<any> | null = null;

async function getVisionModels() {
  if (lm && fd) return { landmarker: lm, detector: fd, poseLm, handLm, segLm };
  installTfliteConsoleFilter();
  const {
    FaceDetector,
    FaceLandmarker,
    FilesetResolver,
    HandLandmarker,
    ImageSegmenter,
    PoseLandmarker,
  } = await import("@mediapipe/tasks-vision");

  const initFromBase = async (wasmBase: string) => {
    const fs = await FilesetResolver.forVisionTasks(wasmBase);
    const [landmarker, detector, pose, hand, seg] = await Promise.all([
      FaceLandmarker.createFromOptions(fs, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        numFaces: 1,
        minFaceDetectionConfidence: 0.12,
        minFacePresenceConfidence: 0.12,
        minTrackingConfidence: 0.12,
      }),
      FaceDetector.createFromOptions(fs, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        minDetectionConfidence: 0.15,
      }).catch(() => null),
      PoseLandmarker.createFromOptions(fs, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        numPoses: 1,
      }).catch(() => null),
      HandLandmarker.createFromOptions(fs, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        numHands: 2,
      }).catch(() => null),
      ImageSegmenter.createFromOptions(fs, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      }).catch(() => null),
    ]);
    return { landmarker, detector, pose, hand, seg };
  };

  if (!visionPromise) {
    visionPromise = initFromBase("/mediapipe-wasm").catch((err) => {
      console.warn("Local mediapipe wasm failed, falling back to CDN 1.2.3:", err);
      return initFromBase("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm");
    });
  }
  const res = await visionPromise;
  lm = res.landmarker;
  fd = res.detector;
  poseLm = res.pose;
  handLm = res.hand;
  segLm = res.seg;
  return { landmarker: lm, detector: fd, poseLm, handLm, segLm };
}

function toDetectionCanvas(img: HTMLImageElement, maxDim = 640): HTMLCanvasElement {
  const w = img.naturalWidth || img.width || 512;
  const h = img.naturalHeight || img.height || 512;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext("2d");
  ctx?.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

async function detectWithGeminiFallback(
  img: HTMLImageElement,
  key: string,
): Promise<FaceKeypoints | null> {
  const storageKey = "amiga.fk." + key;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved) as FaceKeypoints;
      if (parsed?.rightEye && parsed?.leftEye && parsed?.mouthCenter) return parsed;
    }
  } catch {
    /* ignore */
  }

  try {
    const c = toDetectionCanvas(img, 512);
    const dataUrl = c.toDataURL("image/jpeg", 0.85);
    const res = await fetch("/api/face-landmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { detected?: boolean } & Partial<FaceKeypoints>;
    if (!data.detected || !data.rightEye || !data.leftEye || !data.mouthCenter || !data.noseTip) {
      return null;
    }
    const kp: FaceKeypoints = {
      rightEye: data.rightEye,
      leftEye: data.leftEye,
      noseTip: data.noseTip,
      mouthCenter: data.mouthCenter,
      mouthLeft: data.mouthLeft,
      mouthRight: data.mouthRight,
      chin: data.chin,
      forehead: data.forehead,
      stylized: !!data.stylized,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(kp));
    } catch {
      /* ignore */
    }
    return kp;
  } catch {
    return null;
  }
}

function buildFacePts(
  img: HTMLImageElement,
  landmarks: Array<[number, number, number]>,
  faceTris: Uint16Array,
  ovalLoop: number[],
  aspect: number,
  stylized = false,
  poseLandmarks: Array<[number, number, number, number]> | null = null,
  handLandmarks: Array<Array<[number, number, number]>> = [],
  fgMaskCanvas: HTMLCanvasElement | null = null,
  bgCanvas: HTMLCanvasElement | null = null,
): FacePts {
  const distA = (a: number, b: number) => {
    const pa = landmarks[a]!;
    const pb = landmarks[b]!;
    return Math.hypot((pb[0] - pa[0]) * aspect, pb[1] - pa[1]);
  };

  const mouthW = Math.max(0.05, distA(61, 291));
  const restGap = distA(13, 14);
  const restMouthRatio = stylized ? 0 : restGap / mouthW;

  const dLeft = distA(1, 234);
  const dRight = distA(1, 454);
  const yaw = (dLeft - dRight) / Math.max(0.05, dLeft + dRight);

  const faceAxis = makeAxis(
    landmarks[33]![0],
    landmarks[33]![1],
    landmarks[263]![0],
    landmarks[263]![1],
    aspect,
  );
  const mouthAxis = makeAxis(
    landmarks[61]![0],
    landmarks[61]![1],
    landmarks[291]![0],
    landmarks[291]![1],
    aspect,
  );
  const rightEyeAxis = makeAxis(
    landmarks[33]![0],
    landmarks[33]![1],
    landmarks[133]![0],
    landmarks[133]![1],
    aspect,
  );
  const leftEyeAxis = makeAxis(
    landmarks[362]![0],
    landmarks[362]![1],
    landmarks[263]![0],
    landmarks[263]![1],
    aspect,
  );

  const rightIris = extractIris(landmarks, 468, [469, 470, 471, 472], RIGHT_EYE_LOOP);
  const leftIris = extractIris(landmarks, 473, [474, 475, 476, 477], LEFT_EYE_LOOP);

  const mouthMidY = (landmarks[13]![1] + landmarks[14]![1]) / 2;
  const mouthMidX = (landmarks[61]![0] + landmarks[291]![0]) / 2;
  const jawSpan = Math.max(
    0.08,
    Math.hypot((landmarks[152]![0] - mouthMidX) * aspect, landmarks[152]![1] - mouthMidY),
  );

  const analysis = analyzePhotoFeatures(img, landmarks, restMouthRatio, rightIris, leftIris);

  return {
    landmarks,
    aspect,
    faceTris,
    ovalLoop,
    center: [landmarks[1]![0], landmarks[1]![1]],
    faceAxis,
    mouthAxis,
    leftEyeAxis,
    rightEyeAxis,
    rightIris,
    leftIris,
    faceW: Math.max(0.12, distA(234, 454)),
    faceH: Math.max(0.15, distA(10, 152)),
    mouthW,
    jawSpan,
    restMouthRatio,
    hasVisibleTeeth: analysis.hasVisibleTeeth,
    isMouthParted: analysis.isMouthParted,
    restTeethDepth: analysis.restTeethDepth,
    yaw,
    colors: analysis.colors,
    poseLandmarks,
    handLandmarks,
    fgMaskCanvas,
    bgCanvas,
  };
}

export async function detectFace(img: HTMLImageElement, key: string): Promise<FacePts | null> {
  if (cache.has(key)) return cache.get(key)!;
  try {
    installTfliteConsoleFilter();
    const { FaceLandmarker } = await import("@mediapipe/tasks-vision");
    const { faceTris, ovalLoop } = buildCanonicalTopology(FaceLandmarker);
    const aspect =
      img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;

    const { landmarker, detector, poseLm: pLm, handLm: hLm, segLm: sLm } = await getVisionModels();
    const detCanvas = toDetectionCanvas(img, 640);

    // Stage 1: Direct MediaPipe 478-landmark detection (includes 10 iris landmarks!)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (landmarker as any).detect(detCanvas);
    let rawLandmarks = r?.faceLandmarks?.[0] as
      Array<{ x: number; y: number; z?: number }> | undefined;

    let landmarks: Array<[number, number, number]> | null =
      rawLandmarks && rawLandmarks.length >= 468
        ? rawLandmarks.map((pt) => [pt.x, pt.y, pt.z ?? 0])
        : null;
    let stylized = false;

    // Stage 2: Tight crop via FaceDetector
    if (!landmarks && detector) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detRes = (detector as any).detect(detCanvas);
      const det = detRes?.detections?.[0];
      const bb = det?.boundingBox;
      if (bb && bb.width > 8 && bb.height > 8) {
        const size = Math.max(bb.width, bb.height) * 1.75;
        const cx = bb.originX + bb.width * 0.5;
        const cy = bb.originY + bb.height * 0.5;
        const x0 = Math.max(0, cx - size * 0.5);
        const y0 = Math.max(0, cy - size * 0.5);
        const x1 = Math.min(detCanvas.width, cx + size * 0.5);
        const y1 = Math.min(detCanvas.height, cy + size * 0.5);
        const cw = Math.max(16, x1 - x0);
        const ch = Math.max(16, y1 - y0);

        const crop = document.createElement("canvas");
        crop.width = 448;
        crop.height = 448;
        crop.getContext("2d")?.drawImage(detCanvas, x0, y0, cw, ch, 0, 0, 448, 448);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cropRes = (landmarker as any).detect(crop);
        rawLandmarks = cropRes?.faceLandmarks?.[0];
        if (rawLandmarks && rawLandmarks.length >= 468) {
          landmarks = rawLandmarks.map((pt) => [
            (x0 + pt.x * cw) / detCanvas.width,
            (y0 + pt.y * ch) / detCanvas.height,
            ((pt.z ?? 0) * cw) / detCanvas.width,
          ]);
        } else if (det.keypoints?.length >= 4) {
          const kps = det.keypoints as Array<{ x: number; y: number }>;
          const rightEye: [number, number] = [kps[0]!.x, kps[0]!.y];
          const leftEye: [number, number] = [kps[1]!.x, kps[1]!.y];
          const noseTip: [number, number] = [kps[2]!.x, kps[2]!.y];
          const mouthCenter: [number, number] = [kps[3]!.x, kps[3]!.y];
          const rightCheek: [number, number] | undefined = kps[4]
            ? [kps[4].x, kps[4].y]
            : undefined;
          const leftCheek: [number, number] | undefined = kps[5] ? [kps[5].x, kps[5].y] : undefined;
          landmarks = fitCanonicalLandmarks(
            { rightEye, leftEye, noseTip, mouthCenter, rightCheek, leftCheek, stylized: true },
            aspect,
          );
          stylized = true;
        }
      }
    }

    // Stage 3: Anime / 2D Illustration / Painting multimodal fallback
    if (!landmarks) {
      const visionKp = await detectWithGeminiFallback(img, key);
      if (visionKp) {
        landmarks = fitCanonicalLandmarks(visionKp, aspect);
        stylized = visionKp.stylized ?? true;
      }
    }

    if (!landmarks) {
      return null;
    }

    // Detect body pose, hands, and person foreground silhouette for full-body + hand motion without background stretching
    let poseLandmarks: Array<[number, number, number, number]> | null = null;
    let handLandmarks: Array<Array<[number, number, number]>> = [];
    let fgMaskCanvas: HTMLCanvasElement | null = null;
    let bgCanvas: HTMLCanvasElement | null = null;

    try {
      if (pLm) {
        const pRes = pLm.detect(detCanvas);
        const rawPose = pRes?.landmarks?.[0] as
          Array<{ x: number; y: number; z?: number; visibility?: number }> | undefined;
        if (rawPose && rawPose.length >= 29) {
          poseLandmarks = rawPose.map((pt) => [pt.x, pt.y, pt.z ?? 0, pt.visibility ?? 0.8]);
        }
      }
    } catch {
      /* ignore */
    }

    try {
      if (hLm) {
        const hRes = hLm.detect(detCanvas);
        const rawHands = hRes?.landmarks as
          Array<Array<{ x: number; y: number; z?: number }>> | undefined;
        if (rawHands?.length) {
          handLandmarks = rawHands.map((h) => h.map((pt) => [pt.x, pt.y, pt.z ?? 0]));
        }
      }
    } catch {
      /* ignore */
    }

    try {
      if (sLm) {
        const sRes = sLm.segment(detCanvas);
        const masks = sRes?.confidenceMasks;
        if (masks?.length) {
          const personMask = masks[masks.length - 1]!;
          const floatArr = personMask.getAsFloat32Array() as Float32Array;
          const mw = personMask.width;
          const mh = personMask.height;
          const built = buildForegroundAndBackground(img, floatArr, mw, mh);
          fgMaskCanvas = built.fgMaskCanvas;
          bgCanvas = built.bgCanvas;
        }
        sRes?.close?.();
      }
    } catch {
      /* ignore */
    }

    const out = buildFacePts(
      img,
      landmarks,
      faceTris,
      ovalLoop,
      aspect,
      stylized,
      poseLandmarks,
      handLandmarks,
      fgMaskCanvas,
      bgCanvas,
    );
    cache.set(key, out);
    return out;
  } catch (e) {
    console.warn("face detect failed", e);
    lm = null;
    fd = null;
    poseLm = null;
    handLm = null;
    segLm = null;
    visionPromise = null;
    return null;
  }
}
