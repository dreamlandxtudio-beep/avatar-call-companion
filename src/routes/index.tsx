import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, MessageCircle, Settings2, Video } from "lucide-react";
import {
  applyAvatarPhoto,
  DEFAULT_AVATARS,
  defaultVoiceForGender,
  resizeImage,
  setProfile,
  useMessages,
  useProfile,
} from "@/lib/store";
import { AnimatedAvatar } from "@/components/AnimatedAvatar";
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

function Home() {
  const p = useProfile();
  const msgs = useMessages();
  const last = msgs.at(-1);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-between gap-3 bg-[#131316] px-4 py-4 text-foreground">
      <header className="flex items-center justify-between border-b border-[#27272a] pb-3">
        <span className="font-display text-lg font-bold tracking-tight">Vesper</span>
        <Link
          to="/profile"
          aria-label="Ajustes"
          className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Settings2 className="h-5 w-5" />
        </Link>
      </header>

      <section className="my-auto flex flex-col items-center gap-4">
        <div className="h-[360px] w-full overflow-hidden rounded-2xl border border-[#27272a] bg-black shadow-xl">
          <AnimatedAvatar
            src={p.avatar}
            name={p.name}
            active={false}
            emotion="neutral"
            engine={p.avatarEngine ?? "mediapipe-mesh"}
            liveAvatarUrl={p.liveAvatarUrl}
            className="h-full w-full"
          />
        </div>

        {/* Character.ai style avatar switcher */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {DEFAULT_AVATARS.map((av) => {
            const selected = p.avatar === av.src;
            return (
              <button
                key={av.id}
                type="button"
                onClick={() =>
                  setProfile({
                    name: av.name,
                    avatar: av.src,
                    gender: av.gender,
                    personality: av.personality,
                    voice: defaultVoiceForGender(av.gender),
                  })
                }
                className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                <img src={av.src} alt={av.name} className="h-5 w-5 rounded-full object-cover" />
                <span>{av.name}</span>
              </button>
            );
          })}
          <label className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80">
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

        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">{p.name}</h1>
          <p className="mt-1 line-clamp-1 max-w-xs text-sm text-muted-foreground">
            {p.personality}
          </p>
        </div>

        <div className="grid w-full grid-cols-2 gap-3 pt-2">
          <Link
            to="/chat"
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-secondary px-4 py-3 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            <MessageCircle className="h-4 w-4" />
            Mensaje
          </Link>
          <Link
            to="/call"
            className="shadow-glow flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
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
            className="flex items-center gap-3 rounded-xl border border-[#27272a] bg-card px-3.5 py-2.5 transition-colors hover:bg-card/80"
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
