import { Link } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 md:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-gold/30 text-gold">
            <CalendarDays className="h-4 w-4" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">Mi Turno Ya</span>
        </Link>
        <nav className="flex flex-wrap items-center justify-center gap-1 text-sm">
          <Link to="/" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-foreground">Inicio</Link>
          <Link to="/book" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-foreground">Reservar</Link>
          <Link to="/professionals" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-foreground">Profesionales</Link>
          <Link to="/admin" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-foreground">Administración</Link>
        </nav>
      </div>
    </header>
  );
}
