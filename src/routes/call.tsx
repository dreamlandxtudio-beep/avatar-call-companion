import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Mic, MicOff, Phone, PhoneOff, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addMessage, getMessages, getProfile, useProfile } from "@/lib/store";
import { loadModel, reply, useAIState } from "@/lib/ai";
import { canListen, listen, speak, stopListening, stopSpeaking, unlockAudio } from "@/lib/voice";
import { AnimatedAvatar } from "@/components/AnimatedAvatar";
import { AvatarImg } from "@/components/AvatarImg";

export const Route = createFileRoute("/call")({
  head: () => ({
    meta: [
      { title: "Llamada — Alma" },
      { name: "description", content: "Llamada de voz con tu avatar animado." },
      { property: "og:title", content: "Llamada — Alma" },
      { property: "og:description", content: "Llamada de voz con tu avatar animado." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Call,
});

type Phase = "ringing" | "listening" | "thinking" | "speaking" | "paused";

function Call() {
  const p = useProfile();
  const ai = useAIState();
  const nav = useNavigate();
  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<Phase>("ringing");
  const [caption, setCaption] = useState("");
  const [muted, setMuted] = useState(false);
  const [secs, setSecs] = useState(0);
  const [typed, setTyped] = useState("");
  const alive = useRef(true);
  const mutedRef = useRef(false);
  const listenOk = typeof window !== "undefined" && canListen();

  useEffect(() => () => { alive.current = false; stopListening(); stopSpeaking(); }, []);
  useEffect(() => { if (phase === "ringing") return; const i = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(i); }, [phase === "ringing"]);

  const respond = async (heard: string) => {
    addMessage({ role: "user", content: heard });
    setPhase("thinking"); setCaption("");
    let r = "";
    try { r = await reply(getProfile(), getMessages()); } catch { r = "Perdona, no te escucho bien… la IA no carga en este dispositivo."; }
    if (!alive.current) return;
    addMessage({ role: "assistant", content: r });
    setPhase("speaking"); setCaption(r);
    await speak(r, getProfile().voice, getProfile().language);
  };

  const loop = async () => {
    while (alive.current) {
      if (mutedRef.current || !listenOk) { setPhase("paused"); return; }
      setPhase("listening"); setCaption("");
      const heard = await listen(getProfile().language, setCaption);
      if (!alive.current) return;
      if (!heard) { await new Promise((r) => setTimeout(r, 300)); continue; }
      await respond(heard);
    }
  };

  const start = async () => {
    setStarted(true); unlockAudio();
    loadModel().catch(() => {});
    await new Promise((r) => setTimeout(r, 2200));
    if (!alive.current) return;
    const es = getProfile().language === "es-ES";
    const hi = es ? `¡Hola! Qué alegría que me llames.` : `Hey! So glad you called.`;
    setPhase("speaking"); setCaption(hi);
    await speak(hi, getProfile().voice, getProfile().language);
    loop();
  };

  const toggleMute = () => {
    const m = !muted; setMuted(m); mutedRef.current = m;
    if (m) stopListening(); else if (phase === "paused") loop();
  };
  const hang = () => { alive.current = false; stopListening(); stopSpeaking(); nav({ to: "/" }); };

  const status = { ringing: "Llamando…", listening: "Te escucha…", thinking: "Pensando…", speaking: "Hablando", paused: muted ? "Micrófono apagado" : "Escribe para hablar" }[phase];
  const mm = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <main className="relative mx-auto h-dvh max-w-md overflow-hidden bg-background">
      {p.avatar ? (
        <AnimatedAvatar src={p.avatar} active={phase === "speaking"} className={`absolute inset-0 h-full w-full transition-all duration-700 ${phase === "ringing" ? "scale-110 opacity-40 blur-md" : ""}`} />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-transparent to-background" />

      <div className="relative z-10 flex h-full flex-col items-center px-6 pb-10 pt-14 text-center">
        {phase === "ringing" && (
          <div className="relative mb-6 mt-10">
            {started && <span className="animate-ring absolute inset-0 rounded-full bg-primary/40" />}
            <AvatarImg src={p.avatar} name={p.name} className="relative h-32 w-32 text-5xl" />
          </div>
        )}
        <h1 className="text-3xl font-bold">{p.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{phase === "ringing" ? (started ? "Llamando…" : "Llamada de voz") : `${status} · ${mm}`}</p>
        {ai.status === "loading" && <p className="mt-2 text-xs text-accent">Cargando IA {Math.round(ai.progress * 100)}%</p>}

        <div className="mt-auto w-full">
          {caption && phase !== "ringing" && (
            <p className={`glass mx-auto mb-6 max-w-sm rounded-2xl px-4 py-3 text-[15px] ${phase === "listening" ? "italic text-muted-foreground" : ""}`}>{caption}</p>
          )}
          {phase === "thinking" && <div className="mb-6 flex justify-center gap-1.5">{[0, 1, 2].map((i) => <span key={i} className="animate-dot h-2.5 w-2.5 rounded-full bg-foreground" style={{ animationDelay: `${i * 0.2}s` }} />)}</div>}
          {started && phase === "paused" && (
            <form className="mb-6 flex gap-2" onSubmit={async (e) => { e.preventDefault(); const t = typed.trim(); if (!t) return; setTyped(""); await respond(t); setPhase("paused"); }}>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Escribe lo que quieres decir" className="glass h-12 flex-1 rounded-full px-5 outline-none" />
              <button className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-label="Enviar"><SendHorizontal className="h-5 w-5" /></button>
            </form>
          )}
          {!started ? (
            <div className="flex justify-center gap-16">
              <button onClick={hang} className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive text-destructive-foreground" aria-label="Cancelar"><PhoneOff className="h-7 w-7" /></button>
              <button onClick={start} className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-glow" aria-label="Llamar"><Phone className="h-7 w-7" /></button>
            </div>
          ) : (
            <div className="glass mx-auto flex w-fit gap-8 rounded-full px-8 py-4">
              <button onClick={toggleMute} disabled={!listenOk} className={`flex h-14 w-14 items-center justify-center rounded-full ${muted ? "bg-foreground text-background" : "bg-secondary"}`} aria-label="Silenciar">{muted ? <MicOff /> : <Mic />}</button>
              <button onClick={hang} className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive text-destructive-foreground" aria-label="Colgar"><PhoneOff /></button>
            </div>
          )}
          {!started && <p className="mt-6 text-xs text-muted-foreground">Toca el botón verde para llamar. Usa auriculares para una mejor experiencia.</p>}
        </div>
      </div>
    </main>
  );
}
