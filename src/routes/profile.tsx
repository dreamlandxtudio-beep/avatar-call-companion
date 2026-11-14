import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Camera, Play, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { clearMessages, resizeImage, setProfile, useProfile } from "@/lib/store";
import { KOKORO_VOICES, loadKokoro, speak, systemVoices, unlockAudio } from "@/lib/voice";
import { AvatarImg } from "@/components/AvatarImg";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Personaliza tu avatar — Alma" },
      { name: "description", content: "Elige foto, carácter y voz de tu avatar." },
      { property: "og:title", content: "Personaliza tu avatar — Alma" },
      { property: "og:description", content: "Elige foto, carácter y voz de tu avatar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

const PRESETS = [
  { label: "Cariñosa", personality: "Cálida, dulce y atenta, siempre te anima", style: "Tierna y cercana, usa expresiones afectuosas" },
  { label: "Divertido", personality: "Bromista, ingenioso y con mucha energía", style: "Hace chistes y responde con humor" },
  { label: "Sabio", personality: "Tranquilo, reflexivo y sabio", style: "Habla con calma y da buenos consejos" },
  { label: "Coqueta", personality: "Segura de sí misma, juguetona y encantadora", style: "Ligera, juguetona y con picardía elegante" },
  { label: "Misterioso", personality: "Enigmático, poético y profundo", style: "Frases evocadoras y algo misteriosas" },
];

const field = "w-full rounded-xl bg-card px-4 py-3 outline-none ring-primary focus:ring-2";

function ProfilePage() {
  const p = useProfile();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [kProg, setKProg] = useState<number | null>(null);
  useEffect(() => {
    const up = () => setVoices(systemVoices(p.language));
    up(); speechSynthesis.addEventListener?.("voiceschanged", up);
    return () => speechSynthesis.removeEventListener?.("voiceschanged", up);
  }, [p.language]);

  const pickVoice = async (v: string) => {
    const [engine, id] = v.split("|") as ["kokoro" | "system", string];
    setProfile({ voice: { engine, id } });
    if (engine === "kokoro") { setKProg(0); try { await loadKokoro((x) => setKProg(x)); } finally { setKProg(null); } }
  };
  const test = () => { unlockAudio(); speak(p.language === "es-ES" ? `Hola, soy ${p.name}. ¿Qué tal suena mi voz?` : `Hi, I'm ${p.name}. How does my voice sound?`, p.voice, p.language); };

  return (
    <main className="mx-auto max-w-md px-5 pb-16 pt-4">
      <header className="flex items-center gap-3"><Link to="/" aria-label="Volver"><ArrowLeft className="h-6 w-6" /></Link><h1 className="text-xl font-bold">Personalizar</h1></header>

      <label className="relative mx-auto mt-8 block w-fit cursor-pointer">
        <AvatarImg src={p.avatar} name={p.name} className="h-36 w-36 text-5xl" />
        <span className="absolute bottom-1 right-1 rounded-full bg-primary p-2.5 text-primary-foreground"><Camera className="h-5 w-5" /></span>
        <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setProfile({ avatar: await resizeImage(f) }); }} />
      </label>
      <p className="mt-2 text-center text-xs text-muted-foreground">Usa una foto de frente con la cara visible para que se anime mejor.</p>

      <div className="mt-8 space-y-5">
        <div><label className="mb-1.5 block text-sm text-muted-foreground">Nombre</label>
          <input className={field} value={p.name} onChange={(e) => setProfile({ name: e.target.value })} /></div>

        <div><label className="mb-1.5 block text-sm text-muted-foreground">Carácter</label>
          <div className="mb-2 flex flex-wrap gap-2">{PRESETS.map((x) => (
            <button key={x.label} onClick={() => setProfile({ personality: x.personality, style: x.style })} className={`rounded-full px-3 py-1.5 text-sm ${p.personality === x.personality ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{x.label}</button>
          ))}</div>
          <textarea rows={2} className={field} value={p.personality} onChange={(e) => setProfile({ personality: e.target.value })} /></div>

        <div><label className="mb-1.5 block text-sm text-muted-foreground">Su historia</label>
          <textarea rows={3} className={field} value={p.backstory} onChange={(e) => setProfile({ backstory: e.target.value })} /></div>

        <div><label className="mb-1.5 block text-sm text-muted-foreground">Forma de hablar</label>
          <input className={field} value={p.style} onChange={(e) => setProfile({ style: e.target.value })} /></div>

        <div><label className="mb-1.5 block text-sm text-muted-foreground">Idioma</label>
          <div className="grid grid-cols-2 gap-2">{([["es-ES", "Español"], ["en-US", "English"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setProfile({ language: v })} className={`rounded-xl py-3 ${p.language === v ? "bg-primary text-primary-foreground" : "bg-card"}`}>{l}</button>
          ))}</div></div>

        <div><label className="mb-1.5 block text-sm text-muted-foreground">Voz</label>
          <div className="flex gap-2">
            <select className={field} value={`${p.voice.engine}|${p.voice.id}`} onChange={(e) => pickVoice(e.target.value)}>
              <optgroup label="Ultra realistas · Kokoro (inglés)">{KOKORO_VOICES.map((v) => <option key={v.id} value={`kokoro|${v.id}`}>{v.label}</option>)}</optgroup>
              <optgroup label="Voces del dispositivo">
                <option value="system|">Automática</option>
                {voices.map((v) => <option key={v.voiceURI} value={`system|${v.voiceURI}`}>{v.name}</option>)}
              </optgroup>
            </select>
            <button onClick={test} className="rounded-xl bg-secondary px-4" aria-label="Probar voz"><Play className="h-5 w-5" /></button>
          </div>
          {kProg !== null && <p className="mt-1.5 text-xs text-accent">Descargando voz realista… {Math.round(kProg * 100)}%</p>}
          <p className="mt-1.5 text-xs text-muted-foreground">Kokoro suena casi humano pero solo habla inglés. Para español, elige una voz "Natural", "Neural" o "Premium" del dispositivo.</p></div>

        <button onClick={() => confirm("¿Borrar toda la conversación?") && clearMessages()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/40 py-3 text-destructive"><Trash2 className="h-4 w-4" />Borrar conversación</button>
      </div>
    </main>
  );
}
