// Face landmark detection with Google MediaPipe (open source), runs in the browser.
export type FacePts = {
  mouthL: [number, number]; mouthR: [number, number]; lipTop: [number, number]; lipBot: [number, number];
  eyes: { l: number; r: number; t: number; b: number }[]; center: [number, number]; faceW: number; chin: [number, number];
};
const cache = new Map<string, FacePts | null>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lm: any = null;
export async function detectFace(img: HTMLImageElement, key: string): Promise<FacePts | null> {
  if (cache.has(key)) return cache.get(key)!;
  try {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    if (!lm) {
      const fs = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm");
      lm = await FaceLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" },
        runningMode: "IMAGE", numFaces: 1,
      });
    }
    const r = lm.detect(img);
    const p = r.faceLandmarks?.[0];
    if (!p) { cache.set(key, null); return null; }
    const W = img.naturalWidth, H = img.naturalHeight;
    const P = (i: number): [number, number] => [p[i].x * W, p[i].y * H];
    const eye = (a: number, b: number, t: number, bo: number) => ({ l: P(a)[0], r: P(b)[0], t: P(t)[1], b: P(bo)[1] });
    const out: FacePts = {
      mouthL: P(61), mouthR: P(291), lipTop: P(13), lipBot: P(14), chin: P(152),
      eyes: [eye(33, 133, 159, 145), eye(362, 263, 386, 374)],
      center: P(1), faceW: Math.abs(P(454)[0] - P(234)[0]),
    };
    cache.set(key, out); return out;
  } catch (e) { console.warn("face detect failed", e); cache.set(key, null); return null; }
}
