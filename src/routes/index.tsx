import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle, Phone, Settings2, Sparkles } from "lucide-react";
import { useMessages, useProfile } from "@/lib/store";
import { AvatarImg } from "@/components/AvatarImg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Alma — tu avatar con IA" },
      { name: "description", content: "Sube una foto, dale personalidad y voz, y chatea o llama a tu avatar con IA abierta." },
      { property: "og:title", content: "Alma — tu avatar con IA" },
      { property: "og:description", content: "Sube una foto, dale personalidad y voz, y chatea o llama a tu avatar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const p = useProfile();
  const msgs = useMessages();
  const last = msgs.at(-1);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Sparkles className="h-5 w-5 text-primary" />Alma</h1>
        <Link to="/profile" className="rounded-full bg-secondary p-2.5" aria-label="Ajustes"><Settings2 className="h-5 w-5" /></Link>
      </header>

      <section className="mt-10 flex flex-col items-center text-center">
        <div className="relative">
          <AvatarImg src={p.avatar} name={p.name} className="h-40 w-40 text-6xl shadow-glow" />
          <span className="absolute bottom-2 right-2 h-5 w-5 rounded-full border-4 border-background bg-primary" />
        </div>
        <h2 className="mt-5 text-3xl font-bold">{p.name}</h2>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">{p.personality}</p>
        {!p.avatar && (
          <Link to="/profile" className="mt-4 rounded-full border border-primary/40 px-4 py-2 text-sm text-primary">Sube una foto para darle vida</Link>
        )}
        <div className="mt-8 flex gap-6">
          <Link to="/chat" className="flex flex-col items-center gap-2 text-sm">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary"><MessageCircle className="h-7 w-7" /></span>Mensaje
          </Link>
          <Link to="/call" className="flex flex-col items-center gap-2 text-sm">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-glow"><Phone className="h-7 w-7" /></span>Llamar
          </Link>
        </div>
      </section>

      <Link to="/chat" className="mt-10 flex items-center gap-3 rounded-2xl bg-card p-3">
        <AvatarImg src={p.avatar} name={p.name} className="h-12 w-12 text-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex justify-between"><span className="font-semibold">{p.name}</span>
            {last && <span className="text-xs text-muted-foreground">{new Date(last.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}</div>
          <p className="truncate text-sm text-muted-foreground">{last ? last.content : "Toca para empezar a hablar"}</p>
        </div>
      </Link>
      <p className="mt-auto pt-10 text-center text-xs text-muted-foreground">IA de código abierto (Qwen2.5 · Kokoro · MediaPipe) ejecutada en tu dispositivo. Sin cuentas ni costes.</p>
    </main>
  );
}
