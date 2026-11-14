import { useSyncExternalStore } from "react";

export type VoiceChoice = { engine: "kokoro" | "system"; id: string };
export type Profile = {
  name: string;
  avatar: string | null; // data URL
  personality: string;
  backstory: string;
  style: string;
  language: "es-ES" | "en-US";
  voice: VoiceChoice;
};
export type Msg = { role: "user" | "assistant"; content: string; at: number };

const DEFAULT: Profile = {
  name: "Luna",
  avatar: null,
  personality: "Cálida, curiosa y con mucho sentido del humor",
  backstory: "Una amiga cercana a la que le encanta escuchar y contar historias.",
  style: "Respuestas cortas, naturales y cercanas, como en una conversación real",
  language: "es-ES",
  voice: { engine: "system", id: "" },
};

const read = <T,>(k: string, d: T): T => {
  if (typeof window === "undefined") return d;
  try { const v = localStorage.getItem(k); return v ? { ...(d as object), ...JSON.parse(v) } as T : d; } catch { return d; }
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
  try { messages = JSON.parse(localStorage.getItem("amiga.messages") || "[]"); } catch { messages = []; }
}
export function getProfile() { ensure(); return profile; }
export function setProfile(p: Partial<Profile>) {
  ensure(); profile = { ...profile, ...p };
  localStorage.setItem("amiga.profile", JSON.stringify(profile)); emit();
}
export function getMessages() { ensure(); return messages; }
export function addMessage(m: Omit<Msg, "at">) {
  ensure(); messages = [...messages, { ...m, at: Date.now() }];
  localStorage.setItem("amiga.messages", JSON.stringify(messages.slice(-200))); emit();
}
export function clearMessages() { messages = []; localStorage.removeItem("amiga.messages"); emit(); }
const sub = (f: () => void) => { subs.add(f); return () => subs.delete(f); };
export const useProfile = () => useSyncExternalStore(sub, getProfile, () => DEFAULT);
const EMPTY: Msg[] = [];
export const useMessages = () => useSyncExternalStore(sub, getMessages, () => EMPTY);

export async function resizeImage(file: File, max = 720): Promise<string> {
  const url = URL.createObjectURL(file);
  const img = new Image(); img.src = url; await img.decode();
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c.toDataURL("image/jpeg", 0.88);
}
