// Open-source LLM running 100% in the browser (Qwen2.5 0.5B Instruct, ONNX via transformers.js).
import { useSyncExternalStore } from "react";
import type { Msg, Profile } from "./store";

const MODEL = "onnx-community/Qwen2.5-0.5B-Instruct";
type State = { status: "idle" | "loading" | "ready" | "error"; progress: number; device: string; error?: string };
let state: State = { status: "idle", progress: 0, device: "" };
const subs = new Set<() => void>();
const set = (s: Partial<State>) => { state = { ...state, ...s }; subs.forEach((f) => f()); };
export const useAIState = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state, () => state);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let gen: any = null;
let loading: Promise<void> | null = null;

export function loadModel() {
  if (loading) return loading;
  loading = (async () => {
    set({ status: "loading", progress: 0 });
    try {
      const { pipeline } = await import("@huggingface/transformers");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasGPU = !!(navigator as any).gpu && !!(await (navigator as any).gpu.requestAdapter().catch(() => null));
      const files: Record<string, { loaded: number; total: number }> = {};
      gen = await pipeline("text-generation", MODEL, {
        device: hasGPU ? "webgpu" : "wasm",
        dtype: hasGPU ? "q4f16" : "q4",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: (p: any) => {
          if (p.status === "progress" && p.total) {
            files[p.file] = { loaded: p.loaded, total: p.total };
            const v = Object.values(files);
            set({ progress: v.reduce((a, b) => a + b.loaded, 0) / v.reduce((a, b) => a + b.total, 0) });
          }
        },
      });
      set({ status: "ready", progress: 1, device: hasGPU ? "GPU" : "CPU" });
    } catch (e) {
      loading = null;
      set({ status: "error", error: String((e as Error)?.message || e) });
      throw e;
    }
  })();
  return loading;
}

export function systemPrompt(p: Profile) {
  const es = p.language === "es-ES";
  return es
    ? `Eres ${p.name}. Personalidad: ${p.personality}. Historia: ${p.backstory}. Estilo: ${p.style}. Hablas siempre en español, en primera persona, como una persona real en una conversación por chat o llamada. Nunca digas que eres una IA ni un modelo. Responde en 1 a 3 frases.`
    : `You are ${p.name}. Personality: ${p.personality}. Backstory: ${p.backstory}. Style: ${p.style}. Always speak English in first person like a real person on a chat or call. Never say you are an AI. Reply in 1-3 sentences.`;
}

export async function reply(p: Profile, history: Msg[], onToken?: (t: string) => void): Promise<string> {
  await loadModel();
  const { TextStreamer } = await import("@huggingface/transformers");
  const msgs = [{ role: "system", content: systemPrompt(p) }, ...history.slice(-8).map((m) => ({ role: m.role, content: m.content }))];
  let acc = "";
  const streamer = new TextStreamer(gen.tokenizer, {
    skip_prompt: true, skip_special_tokens: true,
    callback_function: (t: string) => { acc += t; onToken?.(acc); },
  });
  const out = await gen(msgs, { max_new_tokens: 110, do_sample: true, temperature: 0.8, top_p: 0.9, repetition_penalty: 1.15, streamer });
  const text = (out?.[0]?.generated_text?.at?.(-1)?.content ?? acc).trim();
  return text || "…";
}
