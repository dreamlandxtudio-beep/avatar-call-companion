import { useAIState, loadModel } from "@/lib/ai";

export function ModelBanner() {
  const s = useAIState();
  if (s.status === "ready") return null;
  return (
    <div className="mx-3 mt-2 rounded-2xl border border-border bg-card p-3 text-sm">
      {s.status === "idle" && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">La IA se ejecuta en tu teléfono, gratis. Descarga única (~400 MB).</span>
          <button onClick={() => loadModel().catch(() => {})} className="shrink-0 rounded-full bg-primary px-3 py-1.5 font-medium text-primary-foreground">Activar</button>
        </div>
      )}
      {s.status === "loading" && (
        <div>
          <div className="mb-1.5 flex justify-between text-muted-foreground"><span>Despertando a la IA…</span><span>{Math.round(s.progress * 100)}%</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${s.progress * 100}%` }} /></div>
        </div>
      )}
      {s.status === "error" && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-destructive">No se pudo cargar la IA en este dispositivo.</span>
          <button onClick={() => loadModel().catch(() => {})} className="rounded-full bg-secondary px-3 py-1.5">Reintentar</button>
        </div>
      )}
    </div>
  );
}
