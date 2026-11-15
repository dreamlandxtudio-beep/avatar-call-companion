// AI engine: Google AI Studio cloud models (fast & smart) + local browser ONNX models in a Web Worker.
import { useSyncExternalStore } from "react";
import { getProfile, type ModelId, type Msg, type Profile } from "./store";

export type ModelOption = {
  id: ModelId;
  repo: string;
  name: string;
  tier: string;
  gpuMB: number;
  cpuMB: number;
  cpuDtype?: "q4" | "q8";
  cloud?: boolean;
  desc: string;
};

export const AI_MODELS: ModelOption[] = [
  {
    id: "gemini-flash-lite",
    repo: "gemini-3.1-flash-lite",
    name: "Gemini Flash Lite",
    tier: "Nube · Ultra rápido",
    gpuMB: 0,
    cpuMB: 0,
    cloud: true,
    desc: "Respuestas en menos de 1 segundo sin descargas. Ideal para llamadas y chat fluido.",
  },
  {
    id: "gemini-cloud",
    repo: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen",
    tier: "Nube · Más inteligente",
    gpuMB: 0,
    cpuMB: 0,
    cloud: true,
    desc: "Sin descargas. Razonamiento más profundo y respuestas más elaboradas.",
  },
  {
    id: "smollm2-135m",
    repo: "onnx-community/SmolLM2-135M-Instruct-ONNX",
    name: "SmolLM2 135M",
    tier: "Local · Ultra liviano",
    gpuMB: 112,
    cpuMB: 172,
    cpuDtype: "q4",
    desc: "Local en tu dispositivo. Descarga rápida, ideal para pruebas offline.",
  },
  {
    id: "smollm2-360m",
    repo: "onnx-community/SmolLM2-360M-Instruct-ONNX",
    name: "SmolLM2 360M",
    tier: "Local · Ligero",
    gpuMB: 260,
    cpuMB: 369,
    cpuDtype: "q4",
    desc: "Local rápido y ligero, con respuestas más coherentes.",
  },
  {
    id: "qwen25-0.5b",
    repo: "onnx-community/Qwen2.5-0.5B-Instruct",
    name: "Qwen 2.5 0.5B",
    tier: "Local · Equilibrado",
    gpuMB: 461,
    cpuMB: 488,
    cpuDtype: "q8",
    desc: "Local con buen español y equilibrio entre tamaño y calidad.",
  },
  {
    id: "qwen3-0.6b",
    repo: "onnx-community/Qwen3-0.6B-ONNX",
    name: "Qwen 3 0.6B",
    tier: "Local · Avanzado",
    gpuMB: 543,
    cpuMB: 589,
    cpuDtype: "q8",
    desc: "Local de generación reciente con mejor comprensión.",
  },
  {
    id: "qwen25-1.5b",
    repo: "onnx-community/Qwen2.5-1.5B-Instruct",
    name: "Qwen 2.5 1.5B",
    tier: "Local · Máxima inteligencia",
    gpuMB: 1165,
    cpuMB: 1506,
    cpuDtype: "q8",
    desc: "El modelo local más inteligente. Recomendado con Wi‑Fi y buena RAM.",
  },
];

export function getModelOption(id?: string): ModelOption {
  return AI_MODELS.find((m) => m.id === id) ?? AI_MODELS[0]!;
}

type State = {
  status: "idle" | "loading" | "ready" | "error";
  phase: "" | "downloading" | "initializing";
  modelId: ModelId | "";
  progress: number;
  loadedMB: number;
  totalMB: number;
  device: "" | "GPU" | "CPU" | "Nube";
  error?: string | undefined;
};

let state: State = {
  status: "idle",
  phase: "",
  modelId: "",
  progress: 0,
  loadedMB: 0,
  totalMB: 0,
  device: "",
};

const subs = new Set<() => void>();
const set = (s: Partial<State>) => {
  state = { ...state, ...s };
  subs.forEach((f) => f());
};

export const useAIState = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => state,
  );

export async function detectWebGPU(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gpu = (navigator as any).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

let worker: Worker | null = null;
let loadedWorkerModelId: ModelId | "" = "";
let loadingPromise: Promise<void> | null = null;
let loadResolve: (() => void) | null = null;
let loadReject: ((err: Error) => void) | null = null;
let nextReqId = 1;
const pendingReplies = new Map<
  number,
  {
    onToken?: ((t: string) => void) | undefined;
    resolve: (t: string) => void;
    reject: (e: Error) => void;
  }
>();

function destroyWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  loadedWorkerModelId = "";
  loadingPromise = null;
  loadResolve = null;
  loadReject = null;
  for (const [, p] of pendingReplies) {
    p.reject(new Error("Modelo cancelado."));
  }
  pendingReplies.clear();
}

function getOrCreateWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent) => {
    const data = ev.data as
      | {
          type: "progress";
          id: ModelId;
          phase: "downloading" | "initializing";
          progress: number;
          loadedMB?: number;
          totalMB?: number;
        }
      | { type: "ready"; id: ModelId; device: "GPU" | "CPU" }
      | { type: "load_error"; id: ModelId; error: string }
      | { type: "token"; reqId: number; text: string }
      | { type: "result"; reqId: number; text: string }
      | { type: "reply_error"; reqId: number; error: string };

    if (data.type === "progress") {
      set({
        status: "loading",
        modelId: data.id,
        phase: data.phase,
        progress: data.progress,
        loadedMB: data.loadedMB ?? state.loadedMB,
        totalMB: data.totalMB ?? state.totalMB,
      });
    } else if (data.type === "ready") {
      loadedWorkerModelId = data.id;
      loadingPromise = null;
      set({
        status: "ready",
        phase: "",
        modelId: data.id,
        progress: 1,
        device: data.device,
        error: undefined,
      });
      loadResolve?.();
      loadResolve = null;
      loadReject = null;
    } else if (data.type === "load_error") {
      loadedWorkerModelId = "";
      loadingPromise = null;
      set({
        status: "error",
        phase: "",
        modelId: data.id,
        error: data.error,
      });
      loadReject?.(new Error(data.error));
      loadResolve = null;
      loadReject = null;
    } else if (data.type === "token") {
      pendingReplies.get(data.reqId)?.onToken?.(data.text);
    } else if (data.type === "result") {
      const p = pendingReplies.get(data.reqId);
      if (p) {
        pendingReplies.delete(data.reqId);
        p.resolve(data.text);
      }
    } else if (data.type === "reply_error") {
      const p = pendingReplies.get(data.reqId);
      if (p) {
        pendingReplies.delete(data.reqId);
        p.reject(new Error(data.error));
      }
    }
  };
  worker.onerror = (err) => {
    const msg = err.message || "Error en el motor local.";
    set({ status: "error", phase: "", error: msg });
    loadReject?.(new Error(msg));
    destroyWorker();
  };
  return worker;
}

export function resetModel() {
  destroyWorker();
  set({
    status: "idle",
    phase: "",
    modelId: "",
    progress: 0,
    loadedMB: 0,
    totalMB: 0,
    device: "",
    error: undefined,
  });
}

export function loadModel(requestedId?: ModelId): Promise<void> {
  const target = getModelOption(requestedId ?? getProfile().modelId);

  if (target.cloud) {
    destroyWorker();
    set({
      status: "ready",
      phase: "",
      modelId: target.id,
      progress: 1,
      loadedMB: 0,
      totalMB: 0,
      device: "Nube",
      error: undefined,
    });
    return Promise.resolve();
  }

  if (loadedWorkerModelId === target.id && state.status === "ready") {
    return Promise.resolve();
  }
  if (loadingPromise && state.modelId === target.id) {
    return loadingPromise;
  }

  // Terminate any stale/different worker so switching or cancelling is instant.
  destroyWorker();

  set({
    status: "loading",
    phase: "downloading",
    modelId: target.id,
    progress: 0,
    loadedMB: 0,
    totalMB: 0,
    device: "",
    error: undefined,
  });

  loadingPromise = new Promise<void>((resolve, reject) => {
    loadResolve = resolve;
    loadReject = reject;
    const w = getOrCreateWorker();
    w.postMessage({
      type: "load",
      id: target.id,
      repo: target.repo,
      cpuDtype: target.cpuDtype ?? "q8",
    });
  });

  return loadingPromise;
}

export type AvatarEmotion = "neutral" | "happy" | "laugh" | "angry" | "surprised" | "sad" | "fear";

const EMOTION_MAP: Record<string, AvatarEmotion> = {
  neutral: "neutral",
  feliz: "happy",
  happy: "happy",
  alegre: "happy",
  riendo: "laugh",
  risa: "laugh",
  laugh: "laugh",
  enojado: "angry",
  enojada: "angry",
  furioso: "angry",
  furiosa: "angry",
  angry: "angry",
  sorprendido: "surprised",
  sorprendida: "surprised",
  surprised: "surprised",
  triste: "sad",
  sad: "sad",
  fear: "fear",
  miedo: "fear",
  asustado: "fear",
  asustada: "fear",
  serio: "neutral",
};

export function extractEmotion(raw: string): { text: string; emotion: AvatarEmotion } {
  const trimmed = raw.trimStart();
  const match = /^\[([a-záéíóúñ]+)\]\s*/i.exec(trimmed);
  if (match) {
    const key = match[1]!.toLowerCase();
    const emotion = EMOTION_MAP[key] ?? "neutral";
    return { text: trimmed.slice(match[0].length), emotion };
  }
  // Hide incomplete leading "[..." tag during early streaming chunks
  if (trimmed.startsWith("[") && !trimmed.includes("]")) {
    return { text: "", emotion: "neutral" };
  }
  return { text: trimmed, emotion: "neutral" };
}

export function systemPrompt(p: Profile, callMode = false) {
  const es = p.language === "es-ES";
  const context = es ? " Ajusta la emoción al contenido, no estés siempre feliz. Ante dolor escucha con seriedad; no fuerces risas. No inventes que puedes ver al usuario. Eres un personaje ficticio de IA y debes reconocerlo si te lo preguntan." : " Match emotion to context; do not always smile or laugh. Listen seriously to distress. Do not claim to see the user. You are a fictional AI character; acknowledge this if asked.";
  const voiceGender = p.gender === "male" ? "masculina" : "femenina";
  if (callMode) {
    return es
      ? `Eres ${p.name}. Personalidad: ${p.personality}. Estilo: ${p.style}. Estás en una videollamada en vivo (voz ${voiceGender}). Responde siempre en español natural en primera persona. Empieza SIEMPRE tu respuesta con exactamente una etiqueta emocional entre corchetes según lo que sientas: [neutral], [feliz], [riendo], [enojado], [sorprendido], [triste] o [miedo]. Después escribe 1 o 2 frases muy cortas (menos de 22 palabras) para responder rápido. ${context}`
      : `You are ${p.name}. Personality: ${p.personality}. Style: ${p.style}. You are on a live video call. Always speak natural English in first person. ALWAYS start your reply with one emotion tag in brackets matching your feeling: [neutral], [happy], [laugh], [angry], [surprised], [sad], or [fear]. Then write 1-2 short sentences (under 22 words). ${context}`;
  }
  return es
    ? `Eres ${p.name}. Personalidad: ${p.personality}. Historia: ${p.backstory}. Estilo: ${p.style}. Hablas siempre en español, en primera persona, como una persona real. Empieza SIEMPRE tu respuesta con una etiqueta entre corchetes ([neutral], [feliz], [riendo], [enojado], [sorprendido], [triste] o [miedo]) y luego responde de forma concisa en 1 a 3 frases. ${context}`
    : `You are ${p.name}. Personality: ${p.personality}. Backstory: ${p.backstory}. Style: ${p.style}. Always speak English in first person like a real person. ALWAYS start with one bracketed emotion tag ([neutral], [happy], [laugh], [angry], [surprised], [sad], or [fear]) followed by 1-3 concise sentences. ${context}`;
}

async function replyCloud(
  model: ModelOption,
  p: Profile,
  history: Msg[],
  onToken?: (t: string) => void,
  callMode = false,
): Promise<{ text: string; emotion: AvatarEmotion }> {
  set({
    status: "ready",
    phase: "",
    modelId: model.id,
    progress: 1,
    device: "Nube",
    error: undefined,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 16000);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: model.repo,
        systemInstruction: systemPrompt(p, callMode),
        history: history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        ...(callMode ? { maxOutputTokens: 110 } : {}),
      }),
    });

    if (!res.ok || !res.body) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Error del servidor (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let acc = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as { text?: string; error?: string };
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.text) {
            acc += parsed.text;
            const parsedClean = extractEmotion(acc);
            if (parsedClean.text) onToken?.(parsedClean.text);
          }
        } catch (e) {
          if (e instanceof Error && !e.message.includes("JSON")) throw e;
        }
      }
    }

    const finalParsed = extractEmotion(acc);
    return {
      text: finalParsed.text.trim() || "…",
      emotion: finalParsed.emotion,
    };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new Error("Tiempo de espera agotado al conectar con Gemini.");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export async function replyWithEmotion(
  p: Profile,
  history: Msg[],
  onToken?: (t: string) => void,
  opts?: { callMode?: boolean },
): Promise<{ text: string; emotion: AvatarEmotion }> {
  const callMode = !!opts?.callMode;
  const model = getModelOption(p.modelId);
  if (model.cloud) {
    return replyCloud(model, p, history, onToken, callMode);
  }

  // If local model is not ready, race with a 4.5s timeout: if downloading takes longer,
  // fall back immediately to Gemini Cloud so the user receives a response in under 1 second.
  if (state.status !== "ready" || state.modelId !== model.id) {
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Descarga local lenta")), 4500),
      );
      await Promise.race([loadModel(model.id), timeout]);
    } catch (e) {
      console.warn("Local model not ready in time, falling back to fast cloud engine:", e);
      const fallback = getModelOption("gemini-flash-lite");
      return replyCloud(fallback, p, history, onToken, callMode);
    }
  }

  const msgs = [
    { role: "system", content: systemPrompt(p, callMode) },
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
  ];

  const reqId = nextReqId++;
  const raw = await new Promise<string>((resolve, reject) => {
    pendingReplies.set(reqId, {
      onToken: onToken ? (s) => onToken(extractEmotion(s).text) : undefined,
      resolve,
      reject,
    });
    const w = getOrCreateWorker();
    w.postMessage({
      type: "reply",
      reqId,
      id: model.id,
      repo: model.repo,
      cpuDtype: model.cpuDtype ?? "q8",
      messages: msgs,
    });
  });
  return extractEmotion(raw);
}

export async function reply(
  p: Profile,
  history: Msg[],
  onToken?: (t: string) => void,
  opts?: { callMode?: boolean },
): Promise<string> {
  const res = await replyWithEmotion(p, history, onToken, opts);
  return res.text;
}
