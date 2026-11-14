import { useEffect, useRef, useState } from "react";
import { detectFace, type FacePts } from "@/lib/face";
import { audioLevel } from "@/lib/voice";

export function AnimatedAvatar({ src, active, className }: { src: string; active: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [face, setFace] = useState<FacePts | null | undefined>(undefined);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image(); img.src = src;
    img.onload = async () => { imgRef.current = img; setFace(await detectFace(img, src.slice(-200))); };
  }, [src]);

  useEffect(() => {
    let raf = 0, open = 0, blinkT = 2 + Math.random() * 3, last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const c = ref.current, img = imgRef.current; if (!c || !img) return;
      const dt = (now - last) / 1000; last = now; const t = now / 1000;
      if (c.width !== img.naturalWidth) { c.width = img.naturalWidth; c.height = img.naturalHeight; }
      const g = c.getContext("2d")!; const W = c.width, H = c.height;
      const lvl = active ? audioLevel() : 0;
      open += (lvl - open) * Math.min(1, dt * 18);
      const cx = face ? face.center[0] : W / 2, cy = face ? face.center[1] : H * 0.45;
      g.save(); g.clearRect(0, 0, W, H);
      // head sway + breathing + talk nods
      g.translate(cx, cy * 1.6);
      g.rotate(Math.sin(t * 0.7) * 0.012 + Math.sin(t * 1.9) * 0.01 * open);
      const s = 1.04 + Math.sin(t * 1.3) * 0.006;
      g.scale(s, s);
      g.translate(-cx, -cy * 1.6 + Math.sin(t * 3.1) * 3 * open);
      g.drawImage(img, 0, 0);
      if (face) {
        const mw = face.mouthR[0] - face.mouthL[0];
        const my = (face.lipTop[1] + face.lipBot[1]) / 2;
        const mx = (face.mouthL[0] + face.mouthR[0]) / 2;
        const d = open * mw * 0.32;
        if (d > 0.5) {
          g.fillStyle = "rgba(40,10,14,0.92)";
          g.beginPath(); g.ellipse(mx, my + d / 2, mw * 0.42, d / 2 + 1, 0, 0, Math.PI * 2); g.fill();
          const jawH = Math.max(mw * 0.6, face.chin[1] - my + mw * 0.15);
          const jx = mx - mw * 0.95, jw = mw * 1.9;
          g.save(); g.beginPath(); g.ellipse(mx, my + d + jawH / 2, jw / 2, jawH / 2 + 2, 0, 0, Math.PI * 2); g.clip();
          g.drawImage(img, jx, my, jw, jawH, jx, my + d, jw, jawH);
          g.restore();
        }
        blinkT -= dt;
        const bt = blinkT < 0 ? Math.max(0, 1 - Math.abs(blinkT + 0.08) / 0.08) : 0;
        if (blinkT < -0.16) blinkT = 2.5 + Math.random() * 3.5;
        if (bt > 0) for (const e of face.eyes) {
          const ew = e.r - e.l, eh = Math.max(e.b - e.t, ew * 0.25) * 1.3, x = e.l - ew * 0.15, w = ew * 1.3, top = e.t - eh * 0.6;
          g.drawImage(img, x, top - eh, w, eh, x, top, w, eh * (0.6 + bt * 1.4));
        }
      }
      g.restore();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [face, active]);

  return <canvas ref={ref} className={className} style={{ objectFit: "cover" }} aria-label="Avatar animado" />;
}
