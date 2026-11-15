import { Link } from "@tanstack/react-router";
import { Compass, MessageCircle, Plus, Settings2, Sparkles } from "lucide-react";
import { AvatarImg } from "./AvatarImg";
import { Button } from "./ui/button";
import { useProfile } from "@/lib/store";

export function AppSidebar({ current }: { current: "discover" | "chat" | "profile" }) {
  const p = useProfile();
  return <aside className="app-sidebar">
    <Link to="/" className="brand"><Sparkles className="h-5 w-5 text-accent" />hikari<span className="text-accent">.</span></Link>
    <Button asChild variant="outline" className="mt-8 w-full justify-start"><Link to="/profile"><Plus />Crear personaje</Link></Button>
    <nav className="mt-6 space-y-1" aria-label="Navegación principal">
      <Button asChild variant={current === "discover" ? "secondary" : "ghost"} className="w-full justify-start"><Link to="/"><Compass />Descubrir</Link></Button>
      <Button asChild variant={current === "chat" ? "secondary" : "ghost"} className="w-full justify-start"><Link to="/chat"><MessageCircle />Conversación</Link></Button>
    </nav>
    <p className="mt-9 text-xs font-medium text-muted-foreground">TU PERSONAJE</p>
    <Link to="/chat" className="mt-4 flex items-center gap-3 rounded-md p-2 hover:bg-secondary"><AvatarImg src={p.avatar} name={p.name} className="h-9 w-9" /><div className="min-w-0"><p className="truncate text-sm font-medium">{p.name}</p><p className="text-xs text-muted-foreground">Continuar conversación</p></div></Link>
    <Button asChild variant={current === "profile" ? "secondary" : "ghost"} className="mt-auto w-full justify-start"><Link to="/profile"><Settings2 />Personalizar</Link></Button>
    <p className="mt-4 text-xs text-muted-foreground">Personajes de IA · Hikari</p>
  </aside>;
}