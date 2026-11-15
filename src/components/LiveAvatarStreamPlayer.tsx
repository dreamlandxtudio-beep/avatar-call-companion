import { ExternalLink, Image } from "lucide-react";
import { setProfile } from "@/lib/store";
import { Button } from "./ui/button";

export function LiveAvatarStreamPlayer({ serverUrl, name, fallbackPhoto }: { serverUrl?: string; active: boolean; name: string; fallbackPhoto: string }) {
  let safeUrl: string | undefined;
  try { const parsed = new URL(serverUrl ?? ""); if (["http:", "https:"].includes(parsed.protocol)) safeUrl = parsed.href; } catch { /* No studio configured */ }
  return <div className="absolute inset-0 flex flex-col bg-background">
    <img src={fallbackPhoto} alt={name} className="min-h-0 flex-1 object-cover" />
    <div className="space-y-3 border-t border-border p-4 text-center">
      <p className="text-sm font-medium">Estudio de animación externo</p>
      <p className="text-xs text-muted-foreground">No hay un generador de vídeo conectado a esta llamada. Abrir el estudio no transmite automáticamente tu foto ni tu voz.</p>
      <div className="flex flex-wrap justify-center gap-2"><Button variant="secondary" onClick={() => setProfile({ avatarEngine: "mediapipe-mesh" })}><Image />Usar foto animada</Button>{safeUrl && <Button asChild variant="outline"><a href={safeUrl} target="_blank" rel="noreferrer"><ExternalLink />Abrir estudio</a></Button>}</div>
    </div>
  </div>;
}
