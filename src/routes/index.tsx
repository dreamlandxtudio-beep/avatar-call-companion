import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, MessageCircle, Settings2, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { applyAvatarPhoto, resizeImage, useMessages, useProfile } from "@/lib/store";
import { AnimatedAvatar, type AvatarEmotion } from "@/components/AnimatedAvatar";
import { AvatarImg } from "@/components/AvatarImg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vesper" },
      {
        name: "description",
        content: "Habla por mensaje o videollamada con tu avatar animado.",
      },
      { property: "og:title", content: "Vesper" },
      {
        property: "og:description",
        content: "Habla por mensaje o videollamada con tu avatar animado.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const PREVIEW_EMOTIONS: Array<{ id: AvatarEmotion; label: string }> = [
  { id: "happy", label: "😊 Feliz" },
  { id: "laugh", label: "😂 Reír" },
  { id: "angry", label: "😠 Enojar" },
  { id: "surprised", label: "😮 Sorpresa" },
];

function Home() {
  const p = useProfile();
  const msgs = useMessages();
  const last = msgs.at(-1);
  const [emotion, setEmotion] = useState<AvatarEmotion>("neutral");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const toggleEmotion = (next: AvatarEmotion) => {
    setEmotion((cur) => (cur === next ? "neutral" : next));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setEmotion("neutral"), 4200);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-between px-5 py-5 text-foreground">
      <header className="flex items-center justify-between">
        <span className="font-display text-xl font-bold tracking-tight">Vesper</span>
        <Link
          to="/profile"
          aria-label="Ajustes"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Settings2 className="h-5 w-5" />
        </Link>
      </header>

      <section className="my-auto flex flex-col items-center py-3">
        <div className="h-[320px] w-full overflow-hidden rounded-3xl border border-border bg-black shadow-lg sm:h-[360px]">
          <AnimatedAvatar
            src={p.avatar}
            name={p.name}
            active={false}
            emotion={emotion}
            engine={p.avatarEngine ?? "mediapipe-mesh"}
            liveAvatarUrl={p.liveAvatarUrl}
            className="h-full w-full"
          />
        </div>

        {/* Clean Controls Below Avatar (nothing overlaps the face) */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {PREVIEW_EMOTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => toggleEmotion(item.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                emotion === item.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {item.label}
            </button>
          ))}
          <label className="flex cursor-pointer items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary">
            <Camera className="h-3.5 w-3.5" />
            <span>Foto</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const dataUrl = await resizeImage(f);
                  await applyAvatarPhoto(dataUrl);
                }
                e.target.value = "";
              }}
            />
          </label>
        </div>

        <h1 className="mt-4 text-2xl font-bold tracking-tight">{p.name}</h1>
        <p className="mt-1 line-clamp-1 max-w-xs text-center text-sm text-muted-foreground">
          {p.personality}
        </p>

        <div className="mt-5 grid w-full grid-cols-2 gap-3">
          <Link
            to="/chat"
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-secondary px-4 py-3 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            <MessageCircle className="h-4 w-4" />
            Mensaje
          </Link>
          <Link
            to="/call"
            className="shadow-glow flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Video className="h-4 w-4" />
            Videollamada
          </Link>
        </div>
      </section>

      <footer className="min-h-[44px]">
        {last && (
          <Link
            to="/chat"
            className="flex items-center gap-3 rounded-2xl border border-border bg-card/60 px-3.5 py-2.5 transition-colors hover:bg-card"
          >
            <AvatarImg src={p.avatar} name={p.name} className="h-8 w-8 shrink-0 text-xs" />
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{last.content}</p>
            <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
              {new Date(last.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </Link>
        )}
      </footer>
    </main>
  );
}
