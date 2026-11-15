import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, SendHorizontal, Settings2, Video, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  addMessage,
  getMessages,
  getProfile,
  setProfile,
  useMessages,
  useProfile,
  type ModelId,
} from "@/lib/store";
import { AI_MODELS, getModelOption, reply, resetModel } from "@/lib/ai";
import { speak, unlockAudio } from "@/lib/voice";
import { AvatarImg } from "@/components/AvatarImg";
import { ModelBanner } from "@/components/ModelBanner";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Mensaje — Vesper" },
      { name: "description", content: "Chatea con tu avatar." },
      { property: "og:title", content: "Mensaje — Vesper" },
      { property: "og:description", content: "Chatea con tu avatar." },
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

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length, typing]);

  const send = async () => {
    const t = text.trim();
    if (!t || typing !== null) return;
    setText("");
    addMessage({ role: "user", content: t });
    setTyping("");
    try {
      const r = await reply(getProfile(), getMessages(), (s) => setTyping(s));
      addMessage({ role: "assistant", content: r });
    } catch (e) {
      const detail = e instanceof Error ? e.message : "";
      addMessage({
        role: "assistant",
        content: detail
          ? `(Error al responder: ${detail})`
          : "(No pude responder: prueba elegir otro modelo arriba o en Ajustes.)",
      });
    } finally {
      setTyping(null);
    }
  };

  const activeModel = getModelOption(p.modelId);

  return (
    <main className="mx-auto flex h-dvh max-w-md flex-col bg-background">
      <header className="flex min-h-[58px] items-center gap-2 border-b border-border px-2.5 py-2">
        <Link
          to="/"
          aria-label="Volver"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-foreground hover:bg-secondary/60"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <AvatarImg src={p.avatar} name={p.name} className="h-9 w-9 shrink-0 text-sm" />
        <div className="min-w-0 flex-1 pl-0.5">
          <div className="truncate text-sm font-semibold leading-tight">{p.name}</div>
          <div className="flex items-center text-xs text-muted-foreground">
            {typing !== null ? (
              <span className="text-primary">escribiendo…</span>
            ) : (
              <select
                aria-label="Modelo de IA"
                value={activeModel.id}
                onChange={(e) => {
                  const id = e.target.value as ModelId;
                  setProfile({ modelId: id });
                  resetModel();
                }}
                className="max-w-full truncate bg-transparent text-xs text-muted-foreground outline-none hover:text-foreground"
              >
                {AI_MODELS.map((m) => (
                  <option key={m.id} value={m.id} className="bg-card text-foreground">
                    {m.name} ({m.tier})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <Link
          to="/call"
          aria-label="Videollamada"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-foreground hover:bg-secondary/60"
        >
          <Video className="h-5 w-5" />
        </Link>
        <Link
          to="/profile"
          aria-label="Ajustes"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        >
          <Settings2 className="h-5 w-5" />
        </Link>
      </header>

      <ModelBanner />

      <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-4">
        {msgs.length === 0 && (
          <p className="py-10 text-center text-xs text-muted-foreground">
            Los mensajes se guardan solo en este dispositivo.
          </p>
        )}

        {msgs.map((m, idx) => (
          <div
            key={`${m.at}-${idx}`}
            className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {m.role === "assistant" && (
              <AvatarImg
                src={p.avatar}
                name={p.name}
                className="mb-0.5 h-7 w-7 shrink-0 text-[10px]"
              />
            )}
            <div
              className={`max-w-[80%] px-3.5 py-2 text-[15px] ${
                m.role === "user"
                  ? "rounded-2xl rounded-br-md bg-primary text-primary-foreground"
                  : "rounded-2xl rounded-bl-md bg-card text-foreground"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              <div
                className={`mt-0.5 flex items-center justify-end gap-2 text-[10px] ${
                  m.role === "user" ? "text-primary-foreground/75" : "text-muted-foreground"
                }`}
              >
                {m.role === "assistant" && (
                  <button
                    type="button"
                    aria-label="Escuchar"
                    onClick={() => {
                      unlockAudio();
                      speak(m.content, p.voice, p.language);
                    }}
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <span className="tabular-nums">
                  {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          </div>
        ))}

        {typing !== null && (
          <div className="flex items-end gap-2">
            <AvatarImg
              src={p.avatar}
              name={p.name}
              className="mb-0.5 h-7 w-7 shrink-0 text-[10px]"
            />
            <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-card px-3.5 py-2 text-[15px] text-foreground">
              {typing || (
                <span className="flex gap-1 py-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="animate-dot h-2 w-2 rounded-full bg-muted-foreground"
                      style={{ animationDelay: `${i * 0.2}s` }}
                    />
                  ))}
                </span>
              )}
            </div>
          </div>
        )}
        <div ref={end} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Escribe a ${p.name}…`}
          className="h-11 flex-1 rounded-full border border-border bg-card px-4 text-sm outline-none ring-primary focus:ring-2"
        />
        <button
          type="submit"
          aria-label="Enviar"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-45"
          disabled={!text.trim() || typing !== null}
        >
          <SendHorizontal className="h-5 w-5" />
        </button>
      </form>
    </main>
  );
}
