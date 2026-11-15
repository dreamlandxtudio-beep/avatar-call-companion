import { Activity, ExternalLink, RefreshCw, Server, WifiOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { setProfile } from "@/lib/store";

export function LiveAvatarStreamPlayer({
  serverUrl = "http://localhost:7860",
  active,
  name,
  fallbackPhoto,
}: {
  serverUrl?: string;
  active: boolean;
  name: string;
  fallbackPhoto: string;
}) {
  const [status, setStatus] = useState<"checking" | "connected" | "offline">("checking");
  const [details, setDetails] = useState<string>("");

  const checkStatus = useCallback(async () => {
    setStatus("checking");
    try {
      const res = await fetch(`/api/liveavatar/status?url=${encodeURIComponent(serverUrl)}`);
      if (!res.ok) throw new Error("HTTP error");
      const data = (await res.json()) as { ok?: boolean; status?: string; error?: string };
      if (data.ok) {
        setStatus("connected");
        setDetails("Servidor LiveAvatar 14B activo");
      } else {
        setStatus("offline");
        setDetails(data.error || "No responde el puerto 7860");
      }
    } catch (e) {
      setStatus("offline");
      setDetails(e instanceof Error ? e.message : "Error al conectar");
    }
  }, [serverUrl]);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 15000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  if (status === "connected") {
    return (
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black">
        {/* LiveAvatar streaming frame / WebRTC receiver */}
        <iframe
          src={`${serverUrl}/?__theme=dark`}
          title="Alibaba LiveAvatar Stream"
          className="h-full w-full border-0 object-cover"
          allow="camera; microphone"
        />
        <div className="glass pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-emerald-400">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          LiveAvatar Diffusion 14B · 45 FPS
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-between bg-background/90 p-6 text-center backdrop-blur-md">
      <div className="glass flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs text-amber-300">
        <Server className="h-4 w-4" />
        <span>Motor Alibaba-Quark/LiveAvatar</span>
      </div>

      <div className="my-auto max-w-sm space-y-4">
        <div className="relative mx-auto h-28 w-28 overflow-hidden rounded-full border-2 border-primary/50 shadow-glow">
          <img src={fallbackPhoto} alt={name} className="h-full w-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            {status === "checking" ? (
              <RefreshCw className="h-8 w-8 animate-spin text-primary" />
            ) : (
              <WifiOff className="h-8 w-8 text-amber-400" />
            )}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-bold">
            {status === "checking" ? "Conectando con LiveAvatar…" : "Esperando servidor LiveAvatar"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {status === "checking"
              ? `Comprobando ${serverUrl}…`
              : `Para generar vídeo por difusión con el modelo de 14B de Alibaba, ejecuta LiveAvatar en tu GPU (${serverUrl}).`}
          </p>
        </div>

        {status === "offline" && (
          <div className="rounded-xl border border-border/80 bg-card/90 p-3 text-left font-mono text-[11px] text-muted-foreground">
            <div className="mb-1 font-semibold text-foreground">Comando de inicio rápido:</div>
            <code>git clone https://github.com/Alibaba-Quark/LiveAvatar</code>
            <br />
            <code>bash gradio_single_gpu.sh</code>
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={checkStatus}
            disabled={status === "checking"}
            className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${status === "checking" ? "animate-spin" : ""}`} />
            Comprobar conexión
          </button>
          <button
            type="button"
            onClick={() => setProfile({ avatarEngine: "mediapipe-mesh" })}
            className="rounded-full border border-border bg-secondary px-4 py-2 text-xs font-medium text-foreground hover:bg-secondary/80"
          >
            Usar Malla Neuronal en Navegador
          </button>
        </div>
      </div>

      <a
        href="https://github.com/Alibaba-Quark/LiveAvatar"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <span>Ver repositorio en GitHub</span>
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
