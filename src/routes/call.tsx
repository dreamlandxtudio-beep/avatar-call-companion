import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Keyboard,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  SendHorizontal,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addMessage, getMessages, getProfile, setProfile, useProfile } from "@/lib/store";
import {
  getModelOption,
  loadModel,
  replyWithEmotion,
  resetModel,
  useAIState,
  type AvatarEmotion,
} from "@/lib/ai";
import {
  canListen,
  finishListening,
  listen,
  speak,
  startBargeInMonitor,
  stopListening,
  stopSpeaking,
  unlockAudio,
} from "@/lib/voice";
import { AnimatedAvatar } from "@/components/AnimatedAvatar";
import { AvatarImg } from "@/components/AvatarImg";

export const Route = createFileRoute("/call")({
  head: () => ({
    meta: [
      { title: "Videollamada — Vesper" },
      { name: "description", content: "Videollamada en tiempo real con tu avatar." },
      { property: "og:title", content: "Videollamada — Vesper" },
      { property: "og:description", content: "Videollamada en tiempo real con tu avatar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Call,
});

type Phase = "ringing" | "listening" | "speaking" | "paused";
type ListenStage = "listening" | "speech" | "transcribing";

function micErrorText(code: string) {
  if (code === "not-allowed") {
    return "Permiso de micrófono bloqueado. Actívalo o usa el teclado.";
  }
  if (code === "audio-capture") {
    return "No se detectó micrófono. Puedes escribir para hablar.";
  }
  return "Micrófono no disponible: escribe para hablar.";
}

function Call() {
  const p = useProfile();
  const ai = useAIState();
  const nav = useNavigate();
  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<Phase>("ringing");
  const [listenStage, setListenStage] = useState<ListenStage>("listening");
  const [micVol, setMicVol] = useState(0);
  const [muted, setMuted] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [micNote, setMicNote] = useState("");
  const [secs, setSecs] = useState(0);
  const [typed, setTyped] = useState("");
  const [sending, setSending] = useState(false);
  const [listenOk, setListenOk] = useState(true);
  const [aiEmotion, setAiEmotion] = useState<AvatarEmotion>("neutral");

  const alive = useRef(true);
  const callTokenRef = useRef(0);
  const loopActiveRef = useRef(false);
  const mutedRef = useRef(false);
  const textModeRef = useRef(false);
  const isRinging = phase === "ringing";
  const mm = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, "0")}`;

  useEffect(() => {
    alive.current = true;
    setListenOk(canListen());
    return () => {
      alive.current = false;
      callTokenRef.current += 1;
      loopActiveRef.current = false;
      stopListening(true);
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    if (!started || isRinging) return;
    const i = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(i);
  }, [started, isRinging]);

  const isCallValid = (token: number) => alive.current && callTokenRef.current === token;

  const speakWithBargeIn = async (
    text: string,
    token: number,
    emotion: AvatarEmotion,
  ): Promise<boolean> => {
    let bargeTriggered = false;
    const stopBargeIn =
      !mutedRef.current && !textModeRef.current && canListen()
        ? startBargeInMonitor(() => {
            bargeTriggered = true;
            stopSpeaking();
          })
        : () => {};
    try {
      await speak(text, getProfile().voice, getProfile().language, emotion);
    } catch {
      // ignore
    } finally {
      stopBargeIn();
    }
    return isCallValid(token) && bargeTriggered;
  };

  const respond = async (heard: string, token: number) => {
    addMessage({ role: "user", content: heard });
    let r = "";
    let em: AvatarEmotion = "neutral";
    try {
      const res = await replyWithEmotion(getProfile(), getMessages(), undefined, {
        callMode: true,
      });
      r = res.text;
      em = res.emotion;
    } catch {
      r = "Perdona, intenta decírmelo de nuevo.";
    }
    if (!isCallValid(token)) return;
    addMessage({ role: "assistant", content: r });
    setAiEmotion(em);
    setPhase("speaking");
    await speakWithBargeIn(r, token, em);
  };

  const loop = async (token: number) => {
    if (loopActiveRef.current) return;
    loopActiveRef.current = true;
    try {
      while (isCallValid(token)) {
        if (mutedRef.current || !canListen() || textModeRef.current) {
          setPhase("paused");
          return;
        }
        setPhase("listening");
        setListenStage("listening");
        setMicVol(0);
        const res = await listen(getProfile().language, {
          onStatus: (s) => {
            if (isCallValid(token)) setListenStage(s);
          },
          onLevel: (lv) => {
            if (isCallValid(token)) setMicVol(lv);
          },
        });
        if (!isCallValid(token)) return;

        if (res.fatalError) {
          textModeRef.current = true;
          setTextMode(true);
          setMicNote(micErrorText(res.fatalError));
          setPhase("paused");
          return;
        }
        if (res.error) {
          setMicNote(res.error);
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        if (!res.text) {
          await new Promise((r) => setTimeout(r, 80));
          continue;
        }
        setMicNote("");
        await respond(res.text, token);
      }
    } finally {
      loopActiveRef.current = false;
    }
  };

  const start = async (preferTextMode = false) => {
    if (started) return;
    const token = ++callTokenRef.current;
    alive.current = true;
    setStarted(true);
    setSecs(0);
    setMicNote("");
    if (preferTextMode) {
      textModeRef.current = true;
      setTextMode(true);
    }
    unlockAudio();
    loadModel(getProfile().modelId).catch(() => {});

    setPhase("ringing");
    await new Promise((r) => setTimeout(r, 100));
    if (!isCallValid(token)) return;

    const es = getProfile().language === "es-ES";
    const hi = es ? "¡Hola! ¿Cómo estás?" : "Hey! Good to see you.";
    setAiEmotion("happy");
    setPhase("speaking");
    await speakWithBargeIn(hi, token, "happy");
    if (!isCallValid(token)) return;

    if (preferTextMode || !canListen()) {
      textModeRef.current = true;
      setTextMode(true);
      if (!canListen()) {
        setMicNote("Tu navegador no permite micrófono: escribe para hablar.");
      }
      setPhase("paused");
      return;
    }

    loop(token);
  };

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    mutedRef.current = m;
    if (m) {
      stopListening(true);
      if (phase === "listening") setPhase("paused");
    } else if (!textModeRef.current && (phase === "paused" || !loopActiveRef.current)) {
      setMicNote("");
      loop(callTokenRef.current);
    }
  };

  const toggleKeyboard = () => {
    const next = !textMode;
    setTextMode(next);
    textModeRef.current = next;
    if (next) {
      stopListening(true);
      if (phase !== "speaking") {
        setPhase("paused");
      }
    } else if (!mutedRef.current && canListen()) {
      setMicNote("");
      if (phase === "paused") {
        loop(callTokenRef.current);
      }
    }
  };

  const hang = () => {
    alive.current = false;
    callTokenRef.current += 1;
    loopActiveRef.current = false;
    stopListening(true);
    stopSpeaking();
    nav({ to: "/" });
  };

  const submitTyped = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = typed.trim();
    if (!t || sending) return;
    const token = callTokenRef.current;
    setTyped("");
    setSending(true);
    stopListening(false);
    stopSpeaking();
    try {
      await respond(t, token);
      if (!isCallValid(token)) return;
      if (!mutedRef.current && !textModeRef.current && canListen()) {
        loop(token);
      } else {
        setPhase("paused");
      }
    } finally {
      setSending(false);
    }
  };

  const listenLabel =
    listenStage === "transcribing"
      ? "Procesando…"
      : listenStage === "speech"
        ? "Te escucha…"
        : "Habla ahora…";

  const status = !started
    ? "Videollamada"
    : {
        ringing: "Conectando…",
        listening: listenLabel,
        speaking: "Hablando",
        paused: muted ? "Micrófono apagado" : "Modo texto",
      }[phase];

  return (
    <main className="mx-auto flex h-dvh max-w-md flex-col gap-3 bg-[#131316] px-3 py-3 text-foreground">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-[#27272a] px-2 py-2">
        <Link
          to="/"
          aria-label="Volver"
          onClick={() => {
            stopListening(true);
            stopSpeaking();
          }}
          className="flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-secondary"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <AvatarImg src={p.avatar} name={p.name} className="h-9 w-9 shrink-0 text-sm" />
        <div className="min-w-0 flex-1 text-left">
          <h1 className="truncate text-base font-bold leading-tight text-foreground">{p.name}</h1>
          <p className="truncate text-xs text-muted-foreground tabular-nums">
            {started && !isRinging ? `${status} · ${mm}` : status}
          </p>
        </div>
      </header>

      {(ai.status === "loading" || ai.status === "error") && (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border border-[#27272a] bg-card px-3 py-2 text-xs rounded-xl">
          {ai.status === "loading" ? (
            <span className="text-accent">
              Cargando {getModelOption(ai.modelId).name} {Math.round(ai.progress * 100)}%
            </span>
          ) : (
            <span className="text-destructive">Error al cargar modelo</span>
          )}
          <button
            type="button"
            onClick={() => {
              setProfile({ modelId: "gemini-flash-lite" });
              resetModel();
              loadModel("gemini-flash-lite").catch(() => {});
            }}
            className="rounded-lg bg-secondary px-2.5 py-1 text-foreground font-medium"
          >
            Usar Gemini rápido
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#27272a] bg-black">
        <AnimatedAvatar
          src={p.avatar}
          name={p.name}
          active={phase === "speaking"}
          emotion={aiEmotion}
          engine={p.avatarEngine ?? "mediapipe-mesh"}
          liveAvatarUrl={p.liveAvatarUrl}
          className="h-full w-full"
        />
      </div>

      <section className="shrink-0 space-y-3 rounded-2xl border border-[#27272a] bg-card px-4 py-3 text-center">
        {phase === "listening" && (
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex h-4 items-center gap-1" aria-hidden="true">
              {[0.35, 0.7, 1, 0.7, 0.35].map((w, idx) => (
                <span
                  key={idx}
                  className="w-1.5 rounded-full bg-primary transition-all duration-75"
                  style={{
                    height: `${Math.round(5 + Math.min(1, micVol * 1.4) * 12 * w)}px`,
                  }}
                />
              ))}
            </div>
            {listenStage === "speech" && (
              <button
                type="button"
                onClick={finishListening}
                className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-1 text-xs font-semibold text-foreground"
              >
                <Check className="h-3.5 w-3.5 text-primary" />
                Enviar ahora
              </button>
            )}
            {micNote && <p className="text-xs text-muted-foreground">{micNote}</p>}
          </div>
        )}

        {started && phase === "paused" && (
          <div className="space-y-1.5">
            {micNote && <p className="text-xs text-muted-foreground">{micNote}</p>}
            <form className="flex gap-2" onSubmit={submitTyped}>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Escribe lo que quieres decir…"
                disabled={sending}
                className="h-11 flex-1 rounded-xl border border-[#27272a] bg-[#131316] px-4 text-sm text-foreground outline-none ring-primary focus:ring-2 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!typed.trim() || sending}
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
                aria-label="Enviar"
              >
                <SendHorizontal className="h-5 w-5" />
              </button>
            </form>
          </div>
        )}

        {!started ? (
          <div className="flex items-center justify-center gap-8 py-1">
            <button
              type="button"
              onClick={hang}
              className="flex h-13 w-13 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg"
              aria-label="Cancelar"
            >
              <PhoneOff className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => start(false)}
              className="shadow-glow flex h-15 w-15 items-center justify-center rounded-full bg-primary text-primary-foreground"
              aria-label="Llamar"
            >
              <Phone className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => start(true)}
              className="flex h-13 w-13 items-center justify-center rounded-full bg-secondary text-foreground"
              aria-label="Teclado"
            >
              <Keyboard className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <div className="mx-auto flex w-fit gap-4">
            <button
              type="button"
              onClick={toggleMute}
              disabled={!listenOk}
              className={`flex h-11 w-11 items-center justify-center rounded-full ${
                muted ? "bg-foreground text-background" : "bg-secondary text-foreground"
              } disabled:opacity-40`}
              aria-label="Silenciar"
            >
              {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={toggleKeyboard}
              className={`flex h-11 w-11 items-center justify-center rounded-full ${
                textMode ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
              }`}
              aria-label="Teclado"
            >
              <Keyboard className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={hang}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg"
              aria-label="Colgar"
            >
              <PhoneOff className="h-5 w-5" />
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
