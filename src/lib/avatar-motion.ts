/** Photo warping cannot reconstruct occluded geometry. Keep motion within the source's evidence. */
export function mouthMotion(open: number, hasTeeth: boolean, restRatio: number) {
  const speech = Math.max(0, Math.min(1, open));
  return {
    opening: speech * (hasTeeth ? 0.42 : 0.55),
    closure: Math.max(0, Math.min(0.35, restRatio)) * (1 - Math.min(1, speech * 4)),
    useOriginalTeeth: hasTeeth,
    syntheticTeeth: false,
  };
}

export function blinkClosure(progress: number) {
  if (progress <= 0 || progress >= 1) return 0;
  // Fast closing, short complete closure, then slower reopening.
  if (progress < 0.35) return Math.sin((progress / 0.35) * Math.PI / 2);
  if (progress < 0.48) return 1;
  return Math.cos(((progress - 0.48) / 0.52) * Math.PI / 2);
}