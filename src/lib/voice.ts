// Voices: Kokoro-82M (open source, very realistic, runs in-browser) + device voices. Speech recognition via browser.
import type { VoiceChoice } from "./store";

export const KOKORO_VOICES = [
  { id: "af_heart", label: "Heart · mujer, cálida (EN)" },
  { id: "af_bella", label: "Bella · mujer, expresiva (EN)" },
  { id: "af_nicole", label: "Nicole · mujer, susurrada (EN)" },
  { id: "am_michael", label: "Michael · hombre, grave (EN)" },
  { id: "am_fenrir", label: "Fenrir · hombre, intenso (EN)" },
  { id: "bf_emma", label: "Emma · mujer británica (EN)" },
  { id: "bm_george", label: "George · hombre británico (EN)" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let kokoro: any = null;
let kLoading: Promise<void> | null = null;
export function loadKokoro(onProgress?: (p: number) => void) {
  if (kLoading) return kLoading;
  kLoading = (async () => {
    const { KokoroTTS } = await import("kokoro-js");
    kokoro = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype: "q8", device: "wasm",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progress_callback: (p: any) => { if (p.status === "progress" && p.total) onProgress?.(p.loaded / p.total); },
    });
  })().catch((e) => { kLoading = null; throw e; });
  return kLoading;
}

export function systemVoices(lang: string) {
  if (typeof speechSynthesis === "undefined") return [];
  const all = speechSynthesis.getVoices();
  const pre = lang.slice(0, 2);
  return all.filter((v) => v.lang.startsWith(pre)).sort((a, b) => score(b) - score(a));
}
const score = (v: SpeechSynthesisVoice) => (/natural|neural|premium|enhanced|google|siri/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let current: AudioBufferSourceNode | null = null;
let fakeLevel = 0;
export function audioLevel(): number {
  if (analyser && current) {
    const d = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(d);
    let s = 0; for (const x of d) s += ((x - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(s / d.length) * 5);
  }
  return fakeLevel;
}
export function unlockAudio() {
  if (!ctx) { ctx = new AudioContext(); analyser = ctx.createAnalyser(); analyser.fftSize = 512; analyser.connect(ctx.destination); }
  ctx.resume();
  return ctx;
}
export function stopSpeaking() {
  try { current?.stop(); } catch { /* */ }
  current = null; fakeLevel = 0;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

export async function speak(text: string, voice: VoiceChoice, lang: string): Promise<void> {
  stopSpeaking();
  const clean = text.replace(/[*_#`]/g, "").replace(/\([^)]*\)/g, "");
  if (voice.engine === "kokoro") {
    try {
      await loadKokoro();
      const a = await kokoro.generate(clean, { voice: voice.id || "af_heart" });
      const c = unlockAudio();
      const buf = c.createBuffer(1, a.audio.length, a.sampling_rate);
      buf.copyToChannel(a.audio, 0);
      const src = c.createBufferSource(); src.buffer = buf; src.connect(analyser!);
      current = src;
      await new Promise<void>((r) => { src.onended = () => { if (current === src) current = null; r(); }; src.start(); });
      return;
    } catch (e) { console.warn("Kokoro failed, falling back", e); }
  }
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = lang;
    const v = speechSynthesis.getVoices().find((x) => x.voiceURI === voice.id) || systemVoices(lang)[0];
    if (v) u.voice = v;
    let alive = true;
    const tick = () => { if (!alive) return; fakeLevel = 0.25 + Math.random() * 0.6; setTimeout(tick, 90); };
    u.onstart = tick;
    u.onend = u.onerror = () => { alive = false; fakeLevel = 0; resolve(); };
    speechSynthesis.speak(u);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SR = () => (typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null);
export const canListen = () => !!SR();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let rec: any = null;
export function listen(lang: string, onInterim: (t: string) => void): Promise<string> {
  return new Promise((resolve) => {
    const R = SR(); if (!R) return resolve("");
    rec = new R(); rec.lang = lang; rec.interimResults = true; rec.continuous = false;
    let final = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let t = ""; for (const r of e.results) t += r[0].transcript;
      final = t; onInterim(t);
    };
    rec.onend = () => resolve(final.trim());
    rec.onerror = () => resolve(final.trim());
    rec.start();
  });
}
export function stopListening() { try { rec?.abort(); } catch { /* */ } rec = null; }
