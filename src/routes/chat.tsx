import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Phone, SendHorizontal, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addMessage, getMessages, getProfile, useMessages, useProfile } from "@/lib/store";
import { reply } from "@/lib/ai";
import { speak, unlockAudio } from "@/lib/voice";
import { AvatarImg } from "@/components/AvatarImg";
import { ModelBanner } from "@/components/ModelBanner";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Chat — Alma" },
      { name: "description", content: "Chatea con tu avatar personalizado." },
      { property: "og:title", content: "Chat — Alma" },
      { property: "og:description", content: "Chatea con tu avatar personalizado." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Chat,
});

function Chat() {
  const p = useProfile();
  const msgs = useMessages();
  const [text, setText] = useState("");
  const [typing, setTyping] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length, typing]);

  const send = async () => {
    const t = text.trim(); if (!t || typing !== null) return;
    setText(""); addMessage({ role: "user", content: t }); setTyping("");
    try {
      const r = await reply(getProfile(), getMessages(), (s) => setTyping(s));
      addMessage({ role: "assistant", content: r });
    } catch { addMessage({ role: "assistant", content: "(No pude responder: la IA no está disponible en este dispositivo.)" }); }
    setTyping(null);
  };

  return (
    <main className="mx-auto flex h-dvh max-w-md flex-col">
      <header className="glass flex items-center gap-3 border-b border-border px-3 py-2.5">
        <Link to="/" aria-label="Volver"><ArrowLeft className="h-6 w-6" /></Link>
        <AvatarImg src={p.avatar} name={p.name} className="h-10 w-10" />
        <div className="flex-1"><div className="font-semibold leading-tight">{p.name}</div>
          <div className="text-xs text-primary">{typing !== null ? "escribiendo…" : "en línea"}</div></div>
        <Link to="/call" aria-label="Llamar" className="p-2"><Phone className="h-5 w-5" /></Link>
      </header>
      <ModelBanner />
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {msgs.length === 0 && <p className="mx-auto mt-10 max-w-60 rounded-xl bg-card p-3 text-center text-xs text-muted-foreground">Los mensajes se guardan solo en este dispositivo. Di hola a {p.name} 👋</p>}
        {msgs.map((m) => (
          <div key={m.at} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`group max-w-[80%] rounded-2xl px-3.5 py-2 text-[15px] ${m.role === "user" ? "rounded-br-md bg-bubble-me" : "rounded-bl-md bg-bubble-them"}`}>
              {m.content}
              <div className="mt-0.5 flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
                {m.role === "assistant" && <button aria-label="Escuchar" onClick={() => { unlockAudio(); speak(m.content, p.voice, p.language); }}><Volume2 className="h-3.5 w-3.5" /></button>}
                {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          </div>
        ))}
        {typing !== null && (
          <div className="flex"><div className="max-w-[80%] rounded-2xl rounded-bl-md bg-bubble-them px-3.5 py-2 text-[15px]">
            {typing || <span className="flex gap-1 py-1">{[0, 1, 2].map((i) => <span key={i} className="animate-dot h-2 w-2 rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 0.2}s` }} />)}</span>}
          </div></div>
        )}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2 p-3">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Mensaje" className="h-12 flex-1 rounded-full bg-card px-5 outline-none ring-primary focus:ring-2" />
        <button aria-label="Enviar" className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50" disabled={!text.trim() || typing !== null}><SendHorizontal className="h-5 w-5" /></button>
      </form>
    </main>
  );
}
