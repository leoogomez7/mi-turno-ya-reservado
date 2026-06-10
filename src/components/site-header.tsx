import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarDays, Menu, X } from "lucide-react";

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="relative mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 md:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-gold/30 text-gold">
            <CalendarDays className="h-4 w-4" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">Mi Turno Ya</span>
        </Link>

        <nav className="hidden md:flex flex-wrap items-center justify-center gap-1 text-sm">
          <Link to="/" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-foreground">Inicio</Link>
          <Link to="/book" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-foreground">Reservar</Link>
          <Link to="/professionals" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-foreground">Profesionales</Link>
          <Link to="/admin" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-foreground">Administración</Link>
        </nav>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-2 text-sm text-foreground shadow-sm transition hover:bg-background md:hidden"
        >
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          <span>Menú</span>
        </button>

        {open && (
          <div className="absolute right-4 top-full z-50 mt-2 w-[calc(100vw-2rem)] max-w-xs rounded-3xl border border-border/60 bg-black p-3 shadow-2xl md:hidden">
            <nav className="flex flex-col gap-2 text-sm">
              <Link
                to="/"
                onClick={() => setOpen(false)}
                className="block rounded-2xl px-4 py-3 text-foreground hover:bg-border/10"
              >
                Inicio
              </Link>
              <Link
                to="/book"
                onClick={() => setOpen(false)}
                className="block rounded-2xl px-4 py-3 text-foreground hover:bg-border/10"
              >
                Reservar
              </Link>
              <Link
                to="/professionals"
                onClick={() => setOpen(false)}
                className="block rounded-2xl px-4 py-3 text-foreground hover:bg-border/10"
              >
                Profesionales
              </Link>
              <Link
                to="/admin"
                onClick={() => setOpen(false)}
                className="block rounded-2xl px-4 py-3 text-foreground hover:bg-border/10"
              >
                Administración
              </Link>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
