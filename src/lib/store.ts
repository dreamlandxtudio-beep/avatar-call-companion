import { useSyncExternalStore } from "react";
import { CHARACTERS, characterProfile } from "./characters";

export type VoiceChoice = { engine: "gemini" | "kokoro" | "system"; id: string };
export type AvatarGender = "female" | "male";
export type ModelId =
  | "gemini-flash-lite"
  | "gemini-cloud"
  | "smollm2-135m"
  | "smollm2-360m"
  | "qwen25-0.5b"
  | "qwen3-0.6b"
  | "qwen25-1.5b";

export type AvatarEngine = "mediapipe-mesh" | "liveavatar";

export type Profile = {
  characterId?: string;
  name: string;
  avatar: string | null; // data URL or relative photo URL
  gender?: AvatarGender;
  personality: string;
  backstory: string;
  style: string;
  language: "es-ES" | "en-US";
  voice: VoiceChoice;
  modelId: ModelId;
  avatarEngine?: AvatarEngine;
  liveAvatarUrl?: string;
  configVersion?: number;
};
export type Msg = { role: "user" | "assistant"; content: string; at: number };

const FEMALE_VOICES = new Set(["Kore", "Zephyr", "af_heart", "af_bella", "af_nicole", "bf_emma", "Aoede", "Leda", "Sulafat"]);
const MALE_VOICES = new Set(["Puck", "Charon", "Fenrir", "am_michael", "am_fenrir", "bm_george", "Orus", "Algenib", "Achird"]);

export function defaultVoiceForGender(gender: AvatarGender, current?: VoiceChoice): VoiceChoice {
  if (gender === "male") {
    if (current && MALE_VOICES.has(current.id)) return current;
    return { engine: "gemini", id: "Puck" };
  }
  if (current && FEMALE_VOICES.has(current.id)) return current;
  return { engine: "gemini", id: "Kore" };
}

const DEFAULT: Profile = {
  characterId: "elena",
  name: "Elena",
  avatar: CHARACTERS[0]?.avatar ?? "/avatars/default.jpg",
  gender: "female",
  personality: "Cálida, curiosa y con mucho sentido del humor",
  backstory: "Una compañera cercana y vivaz a la que le encanta escuchar y contar historias.",
  style: "Respuestas cortas, naturales y cercanas, como en una conversación real",
  language: "es-ES",
  voice: { engine: "gemini", id: "Kore" },
  modelId: "gemini-flash-lite",
  avatarEngine: "mediapipe-mesh",
  liveAvatarUrl: "http://localhost:7860",
  configVersion: 7,
};

const read = <T>(k: string, d: T): T => {
  if (typeof window === "undefined") return d;
  try {
    const v = localStorage.getItem(k);
    return v ? ({ ...(d as object), ...JSON.parse(v) } as T) : d;
  } catch {
    return d;
  }
};

let profile: Profile = DEFAULT;
let messages: Msg[] = [];
let loaded = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function ensure() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  profile = read("amiga.profile", DEFAULT);
  if (!profile.configVersion || profile.configVersion < 7) {
    const gender: AvatarGender =
      profile.gender ?? (profile.avatar?.includes("male.jpg") ? "male" : "female");
    profile = {
      ...profile,
      name:
        !profile.name || profile.name === "Luna" || profile.name === "Alma" || profile.name === "Vesper"
          ? "Elena"
          : profile.name,
      avatar: !profile.avatar || profile.avatar === "/avatars/default.jpg" ? CHARACTERS[0]?.avatar ?? profile.avatar : profile.avatar,
      characterId: profile.characterId ?? "custom",
      gender,
      modelId: "gemini-flash-lite",
      avatarEngine: profile.avatarEngine ?? "mediapipe-mesh",
      liveAvatarUrl: profile.liveAvatarUrl ?? "http://localhost:7860",
      voice: defaultVoiceForGender(gender, profile.voice),
      configVersion: 7,
    };
    try {
      localStorage.setItem("amiga.profile", JSON.stringify(profile));
    } catch {
      /* ignore */
    }
  }
  try {
    messages = JSON.parse(localStorage.getItem(messageKey()) || localStorage.getItem("amiga.messages") || "[]");
  } catch {
    messages = [];
  }
}

function messageKey() { return `amiga.messages.${profile.characterId ?? "custom"}`; }

export function selectCharacter(id: string) {
  const next = characterProfile(id);
  if (!next) return;
  ensure();
  setProfile(next);
  try { messages = JSON.parse(localStorage.getItem(messageKey()) || "[]"); } catch { messages = []; }
  emit();
}

export function getProfile() {
  ensure();
  return profile;
}

export function setProfile(p: Partial<Profile>) {
  ensure();
  const nextGender = p.gender ?? profile.gender ?? "female";
  const nextVoice =
    p.gender && !p.voice
      ? defaultVoiceForGender(nextGender, profile.voice)
      : (p.voice ?? profile.voice);
  profile = { ...profile, ...p, gender: nextGender, voice: nextVoice };
  try {
    localStorage.setItem("amiga.profile", JSON.stringify(profile));
  } catch {
    /* ignore */
  }
  emit();
}

export async function applyAvatarPhoto(dataUrl: string) {
  ensure();
  const previousKey = messageKey();
  const previousMessages = messages;
  setProfile({ avatar: dataUrl, characterId: "custom" });
  if (previousKey !== messageKey()) {
    try { localStorage.setItem(messageKey(), JSON.stringify(previousMessages)); } catch { /* ignore */ }
  }
  if (typeof window === "undefined" || !dataUrl.startsWith("data:")) return;
  try {
    const res = await fetch("/api/avatar-gender", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { gender?: AvatarGender };
    if (data.gender === "male" || data.gender === "female") {
      // Only update if user is still using this uploaded photo
      if (getProfile().avatar === dataUrl) {
        setProfile({
          gender: data.gender,
          voice: defaultVoiceForGender(data.gender, getProfile().voice),
        });
      }
    }
  } catch {
    /* ignore */
  }
}

export function getMessages() {
  ensure();
  return messages;
}

export function addMessage(m: Omit<Msg, "at">) {
  ensure();
  messages = [...messages, { ...m, at: Date.now() }];
  try {
    localStorage.setItem(messageKey(), JSON.stringify(messages.slice(-200)));
  } catch {
    /* ignore */
  }
  emit();
}

export function clearMessages() {
  ensure();
  messages = [];
  try {
    localStorage.removeItem(messageKey());
    localStorage.removeItem("amiga.messages");
  } catch {
    /* ignore */
  }
  emit();
}

const sub = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export const useProfile = () => useSyncExternalStore(sub, getProfile, () => DEFAULT);
const EMPTY: Msg[] = [];
export const useMessages = () => useSyncExternalStore(sub, getMessages, () => EMPTY);

export async function resizeImage(file: File, max = 720): Promise<string> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  const context = c.getContext("2d");
  if (!context) { URL.revokeObjectURL(url); throw new Error("No se pudo leer la foto"); }
  context.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c.toDataURL("image/jpeg", 0.88);
}
