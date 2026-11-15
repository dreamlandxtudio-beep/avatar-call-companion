import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, Check, MessageCircle, Search, Settings2, Sparkles, Video, Volume2 } from "lucide-react";
import { useRef, useState } from "react";
import { applyAvatarPhoto, resizeImage, selectCharacter, useMessages, useProfile } from "@/lib/store";
import { CHARACTERS } from "@/lib/characters";
import { AvatarImg } from "@/components/AvatarImg";
import { AppSidebar } from "@/components/AppSidebar";
import { Button } from "@/components/ui/button";
import { speak, unlockAudio } from "@/lib/voice";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Hikari — descubre tus personajes" },
    { name: "description", content: "Elena, Mateo y tus propios personajes: conversaciones, voces y llamadas en Hikari." },
    { property: "og:title", content: "Hikari — descubre tus personajes" },
    { property: "og:description", content: "Conoce a Elena y Mateo o crea tu personaje con una foto, voz y personalidad propias." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }), component: Home,
});

function Home() {
  const p = useProfile();
  const messages = useMessages();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todos");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const characters = CHARACTERS.filter((character) => `${character.name} ${character.personality}`.toLowerCase().includes(query.toLowerCase()) && (category === "Todos" || character.tags.includes(category)));
  return <div className="app-layout"><AppSidebar current="discover" /><main className="discovery-content">
    <header className="flex items-center justify-between gap-4">
      <Link to="/" className="brand md:hidden"><Sparkles className="text-accent" />hikari.</Link>
      <p className="hidden text-sm text-muted-foreground md:block">Un espacio para tus conversaciones.</p>
      <div className="flex items-center gap-3"><span className="hidden text-xs text-muted-foreground sm:block">Tu universo, a tu manera</span><Button asChild variant="ghost" size="icon" aria-label="Ajustes"><Link to="/profile"><Settings2 /></Link></Button></div>
    </header>
    <div className="mt-8 flex flex-wrap items-end justify-between gap-5"><div><p className="mb-2 text-xs font-medium text-accent">CONOCE A ALGUIEN NUEVO</p><h1 className="text-3xl font-semibold">¿Con quién hablamos hoy?</h1></div>
      <label className="flex h-11 w-full items-center gap-2 rounded-full border border-border bg-card px-4 sm:w-64"><Search className="h-4 w-4 shrink-0 text-muted-foreground" /><input aria-label="Buscar personajes" placeholder="Buscar personajes" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 w-full bg-transparent text-sm outline-none" /></label>
    </div>
    <div className="mb-7 mt-7 flex flex-wrap gap-2">{["Todos", "Cercana", "Tranquilo", "Creativa"].map((tag) => <Button key={tag} variant={category === tag ? "default" : "secondary"} className="rounded-full" aria-pressed={category === tag} onClick={() => setCategory(tag)}>{tag}</Button>)}</div>
    <section aria-label="Personajes" className="character-grid">{characters.map((character) => <article key={character.id} className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
      <div className="relative"><img src={character.avatar} alt={character.name} width={768} height={1024} className="character-photo" />{p.characterId === character.id && <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-background/90 px-3 py-1 text-xs"><Check className="h-3 w-3 text-accent" />Tu personaje</span>}</div>
      <div className="p-4 sm:p-5"><div className="flex items-center justify-between gap-2"><h2 className="text-xl font-semibold">{character.name}</h2><Button variant="ghost" size="icon" title={`Escuchar a ${character.name}`} aria-label={`Escuchar a ${character.name}`} onClick={() => { unlockAudio(); void speak(`Hola, soy ${character.name}. ¿Cómo va tu día?`, character.voice, p.language); }}><Volume2 className="text-muted-foreground" /></Button></div><p className="mt-1 min-h-10 text-sm text-muted-foreground">{character.tagline}</p><div className="mt-3 flex flex-wrap gap-2">{character.tags.map((tag) => <span key={tag} className="text-xs text-accent">{tag}</span>)}</div>
      <div className="mt-5 flex items-center gap-2"><Button asChild className="flex-1"><Link to="/chat" onClick={() => selectCharacter(character.id)}><MessageCircle /><span>Conversar</span></Link></Button><Button asChild variant="secondary" size="icon" className="shrink-0" aria-label={`Llamar a ${character.name}`} title={`Llamar a ${character.name}`}><Link to="/call" onClick={() => selectCharacter(character.id)}><Video /></Link></Button></div></div>
    </article>)}</section>
    {characters.length === 0 && <p className="py-12 text-muted-foreground">No hay personajes que coincidan.</p>}
    <section className="mt-8 flex flex-wrap items-center justify-between gap-4 border-y border-border py-6"><div className="flex items-center gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary"><Camera className="h-5 w-5 text-accent" /></div><div><h2 className="text-lg font-semibold">Tu foto. Tu personaje.</h2><p className="mt-1 text-sm text-muted-foreground">Dale un nombre, una voz y su propia historia.</p></div></div><Button variant="outline" disabled={uploading} onClick={() => upload.current?.click()}><Camera />{uploading ? "Preparando foto…" : "Importar foto"}</Button><input ref={upload} type="file" accept="image/*" aria-label="Importar foto" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setUploading(true); setUploadError(""); try { await applyAvatarPhoto(await resizeImage(file)); } catch { setUploadError("No se pudo abrir esta foto. Prueba otra imagen."); } finally { setUploading(false); e.target.value = ""; } }} />{uploadError && <p role="alert" className="w-full text-sm text-destructive">{uploadError}</p>}</section>
    <section className="mt-7 pb-6"><h2 className="mb-4 text-lg font-semibold">Tu conversación</h2><Link to="/chat" className="flex items-center gap-4"><AvatarImg src={p.avatar} name={p.name} className="h-12 w-12" /><div className="min-w-0 flex-1"><p className="font-medium">{p.name}</p><p className="mt-1 truncate text-sm text-muted-foreground">{messages.at(-1)?.content ?? "¿Qué tienes en mente hoy?"}</p></div><MessageCircle className="h-5 w-5 text-muted-foreground" /></Link></section>
  </main></div>;
}
