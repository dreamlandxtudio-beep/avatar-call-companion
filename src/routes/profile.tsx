import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Camera, Play, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  applyAvatarPhoto,
  clearMessages,
  resizeImage,
  setProfile,
  useProfile,
  type ModelId,
} from "@/lib/store";
import {
  AI_MODELS,
  detectWebGPU,
  getModelOption,
  loadModel,
  resetModel,
  useAIState,
} from "@/lib/ai";
import {
  GEMINI_VOICES,
  KOKORO_VOICES,
  loadKokoro,
  speak,
  systemVoices,
  unlockAudio,
} from "@/lib/voice";
import { AvatarImg } from "@/components/AvatarImg";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Personalizar — Vesper" },
      { name: "description", content: "Configura la imagen, voz y carácter de tu avatar." },
      { property: "og:title", content: "Personalizar — Vesper" },
      {
        property: "og:description",
        content: "Configura la imagen, voz y carácter de tu avatar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

const PRESETS = [
  {
    label: "Cariñosa",
    personality: "Cálida, dulce y atenta, siempre te anima",
    style: "Cercana y natural, usa expresiones afectuosas",
  },
  {
    label: "Divertido",
    personality: "Bromista, ingenioso y con mucha energía",
    style: "Hace chistes y responde con humor",
  },
  {
    label: "Tranquilo",
    personality: "Sereno, atento y buen consejero",
    style: "Habla con calma y responde de forma directa",
  },
];

const field = "w-full rounded-xl bg-card px-4 py-3 outline-none ring-primary focus:ring-2";

function ProfilePage() {
  const p = useProfile();
  const ai = useAIState();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [kProg, setKProg] = useState<number | null>(null);
  const [hasGPU, setHasGPU] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [testingUrl, setTestingUrl] = useState(false);
  const [urlStatus, setUrlStatus] = useState<"idle" | "online" | "offline">("idle");
  const [urlMessage, setUrlMessage] = useState("");

  useEffect(() => {
    detectWebGPU().then(setHasGPU);
  }, []);

  useEffect(() => {
    const up = () => setVoices(systemVoices(p.language));
    up();
    if (typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis) {
      window.speechSynthesis.addEventListener?.("voiceschanged", up);
      return () => window.speechSynthesis.removeEventListener?.("voiceschanged", up);
    }
    return undefined;
  }, [p.language]);

  const checkLiveAvatarUrl = async () => {
    const target = (p.liveAvatarUrl ?? "http://localhost:7860").trim();
    setTestingUrl(true);
    setUrlStatus("idle");
    setUrlMessage("");
    try {
      const res = await fetch(`/api/liveavatar/status?url=${encodeURIComponent(target)}`);
      const data = (await res.json()) as {
        ok: boolean;
        statusCode?: number;
        error?: string;
      };
      if (data.ok) {
        setUrlStatus("online");
        setUrlMessage(`Conectado (${data.statusCode ?? 200})`);
      } else {
        setUrlStatus("offline");
        setUrlMessage(data.error ? `Sin respuesta: ${data.error}` : "Servidor no responde");
      }
    } catch (err) {
      setUrlStatus("offline");
      setUrlMessage(err instanceof Error ? err.message : "Error de conexión");
    } finally {
      setTestingUrl(false);
    }
  };

  const pickVoice = async (v: string) => {
    const [engine, id] = v.split("|") as ["gemini" | "kokoro" | "system", string];
    setProfile({ voice: { engine, id } });
    if (engine === "kokoro") {
      setKProg(0);
      try {
        await loadKokoro((x) => setKProg(x));
      } finally {
        setKProg(null);
      }
    }
  };

  const testVoice = () => {
    unlockAudio();
    speak(
      p.language === "es-ES"
        ? `Hola, soy ${p.name}. ¿Qué tal suena mi voz?`
        : `Hi, I'm ${p.name}. How does my voice sound?`,
      p.voice,
      p.language,
    );
  };

  const selectedModel = getModelOption(p.modelId);
  const isSelectedReady =
    !!selectedModel.cloud || (ai.status === "ready" && ai.modelId === selectedModel.id);
  const isSelectedLoading = ai.status === "loading" && ai.modelId === selectedModel.id;

  const pickModel = (id: ModelId) => {
    setProfile({ modelId: id });
    if (ai.status === "loading" || ai.status === "error") {
      resetModel();
    }
  };

  const gender = p.gender ?? "female";

  return (
    <main className="mx-auto max-w-md px-5 pb-16 pt-4">
      <header className="flex items-center gap-3 border-b border-border pb-3">
        <Link
          to="/"
          aria-label="Volver"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full hover:bg-secondary"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-bold">Personalizar avatar</h1>
      </header>

      <div className="mt-6 flex flex-col items-center">
        <label className="group relative block w-fit cursor-pointer">
          <AvatarImg
            src={p.avatar}
            name={p.name}
            className="h-32 w-32 text-4xl shadow-lg ring-2 ring-border"
          />
          <span className="absolute bottom-0 right-0 rounded-full bg-primary p-2.5 text-primary-foreground shadow-md transition-transform group-hover:scale-105">
            <Camera className="h-4 w-4" />
          </span>
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
        <p className="mt-2.5 text-xs text-muted-foreground">
          Toca la imagen para cambiar la foto (la voz se ajusta automáticamente)
        </p>
      </div>

      <div className="mt-7 space-y-5">
        <div>
          <label className="mb-1.5 block text-sm text-muted-foreground">Nombre</label>
          <input
            className={field}
            value={p.name}
            onChange={(e) => setProfile({ name: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-muted-foreground">Género y voz</label>
          <div className="mb-2.5 grid grid-cols-2 gap-2">
            {(
              [
                ["female", "Mujer"],
                ["male", "Hombre"],
              ] as const
            ).map(([g, label]) => (
              <button
                key={g}
                type="button"
                onClick={() => setProfile({ gender: g })}
                className={`rounded-xl py-2.5 text-sm font-medium transition-colors ${
                  gender === g ? "bg-primary text-primary-foreground" : "bg-card text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <select
              className={field}
              value={`${p.voice.engine}|${p.voice.id}`}
              onChange={(e) => pickVoice(e.target.value)}
            >
              <optgroup label="Voces naturales · Gemini">
                {GEMINI_VOICES.map((v) => (
                  <option key={v.id} value={`gemini|${v.id}`}>
                    {v.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Voces offline · Kokoro (EN)">
                {KOKORO_VOICES.map((v) => (
                  <option key={v.id} value={`kokoro|${v.id}`}>
                    {v.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Voces del dispositivo">
                <option value="system|">Automática</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={`system|${v.voiceURI}`}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <button
              type="button"
              onClick={testVoice}
              className="rounded-xl bg-secondary px-4"
              aria-label="Probar voz"
            >
              <Play className="h-4 w-4" />
            </button>
          </div>
          {kProg !== null && (
            <p className="mt-1.5 text-xs text-accent">
              Descargando voz… {Math.round(kProg * 100)}%
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-muted-foreground">Carácter</label>
          <div className="mb-2 flex flex-wrap gap-2">
            {PRESETS.map((x) => (
              <button
                key={x.label}
                type="button"
                onClick={() => setProfile({ personality: x.personality, style: x.style })}
                className={`rounded-full px-3 py-1 text-xs ${
                  p.personality === x.personality
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary"
                }`}
              >
                {x.label}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            className={field}
            value={p.personality}
            onChange={(e) => setProfile({ personality: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-muted-foreground">Historia</label>
          <textarea
            rows={2}
            className={field}
            value={p.backstory}
            onChange={(e) => setProfile({ backstory: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-muted-foreground">Forma de hablar</label>
          <input
            className={field}
            value={p.style}
            onChange={(e) => setProfile({ style: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-muted-foreground">Idioma</label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["es-ES", "Español"],
                ["en-US", "English"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => setProfile({ language: v })}
                className={`rounded-xl py-2.5 text-sm font-medium ${
                  p.language === v ? "bg-primary text-primary-foreground" : "bg-card"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-muted-foreground">Modelo de IA</label>
          <div className="flex gap-2">
            <select
              className={field}
              value={selectedModel.id}
              onChange={(e) => pickModel(e.target.value as ModelId)}
            >
              {AI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.tier} · {m.name} {m.cloud ? "" : `(~${hasGPU ? m.gpuMB : m.cpuMB} MB)`}
                </option>
              ))}
            </select>
            {!selectedModel.cloud && (
              <button
                type="button"
                onClick={() =>
                  isSelectedLoading ? resetModel() : loadModel(selectedModel.id).catch(() => {})
                }
                disabled={isSelectedReady}
                className="shrink-0 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {isSelectedReady ? "Listo" : isSelectedLoading ? "Cancelar" : "Cargar"}
              </button>
            )}
          </div>
        </div>

        <details className="rounded-xl border border-border bg-card/50 p-3.5 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">
            Motor de animación (avanzado)
          </summary>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setProfile({ avatarEngine: "mediapipe-mesh" })}
                className={`rounded-lg border px-3 py-2 text-left ${
                  (p.avatarEngine ?? "mediapipe-mesh") === "mediapipe-mesh"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground"
                }`}
              >
                Malla facial (Navegador)
              </button>
              <button
                type="button"
                onClick={() => setProfile({ avatarEngine: "liveavatar" })}
                className={`rounded-lg border px-3 py-2 text-left ${
                  p.avatarEngine === "liveavatar"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground"
                }`}
              >
                LiveAvatar (Servidor)
              </button>
            </div>
            {p.avatarEngine === "liveavatar" && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="url"
                    className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-xs outline-none ring-primary focus:ring-1"
                    value={p.liveAvatarUrl ?? "http://localhost:7860"}
                    placeholder="http://localhost:7860"
                    onChange={(e) => setProfile({ liveAvatarUrl: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={checkLiveAvatarUrl}
                    disabled={testingUrl}
                    className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${testingUrl ? "animate-spin" : ""}`} />
                    Probar
                  </button>
                </div>
                {urlStatus !== "idle" && (
                  <p className={urlStatus === "online" ? "text-emerald-400" : "text-destructive"}>
                    {urlMessage}
                  </p>
                )}
              </div>
            )}
          </div>
        </details>

        {confirmClear ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                clearMessages();
                setConfirmClear(false);
              }}
              className="flex-1 rounded-xl bg-destructive py-3 text-sm font-semibold text-destructive-foreground"
            >
              Sí, borrar conversación
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="rounded-xl border border-input bg-background px-4 py-3 text-sm"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/40 py-3 text-sm font-medium text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
            Borrar conversación
          </button>
        )}
      </div>
    </main>
  );
}
