import { createFileRoute, Link } from "@tanstack/react-router";
import { Calendar, Scissors, Sparkles, Star, Clock, Award } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { WhatsappButton } from "@/components/whatsapp-button";
import { Button } from "@/components/ui/button";
import { BARBERS, SERVICES } from "@/lib/salon-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Atelier Barber — Reservá tu turno online" },
      { name: "description", content: "Reservá tu turno en segundos. Elegí peluquero, servicio y horario en una experiencia premium." },
      { property: "og:title", content: "Atelier Barber — Reservá tu turno online" },
      { property: "og:description", content: "Reservá tu turno en segundos. Elegí peluquero, servicio y horario." },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 opacity-30">
          <div className="absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-gold/20 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-6xl px-6 pt-24 pb-32 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/5 px-4 py-1.5 text-xs uppercase tracking-widest text-gold">
            <Sparkles className="h-3 w-3" /> Experiencia premium
          </div>
          <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
            Reservá tu turno
            <br />
            <span className="text-gradient-gold">online</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Elegí tu peluquero favorito y reservá en segundos.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-14 bg-gold px-10 text-base font-semibold text-primary-foreground shadow-gold hover:bg-gold-soft">
              <Link to="/book"><Calendar className="mr-2 h-5 w-5" /> RESERVAR TURNO</Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="h-14 px-8 text-base">
              <a href="#equipo">Conocer al equipo</a>
            </Button>
          </div>

          <div className="mt-16 grid grid-cols-3 gap-6 border-t border-border/50 pt-10 text-left sm:gap-12">
            {[
              { icon: Award, k: "+12 años", v: "de experiencia" },
              { icon: Star, k: "4.9 / 5", v: "valoración promedio" },
              { icon: Clock, k: "30 seg", v: "para reservar" },
            ].map(({ icon: Icon, k, v }) => (
              <div key={k} className="flex items-center gap-3">
                <Icon className="h-5 w-5 shrink-0 text-gold" />
                <div>
                  <div className="font-display text-lg font-semibold">{k}</div>
                  <div className="text-xs text-muted-foreground">{v}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* EQUIPO */}
      <section id="equipo" className="border-t border-border/50 bg-surface/40 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-12 flex items-end justify-between">
            <div>
              <p className="mb-2 text-xs uppercase tracking-widest text-gold">Nuestro equipo</p>
              <h2 className="font-display text-4xl font-semibold">Peluqueros expertos</h2>
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {BARBERS.map((b) => (
              <div key={b.id} className="group rounded-2xl border border-border bg-card p-6 transition-all hover:border-gold/40 hover:shadow-gold">
                <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-gold/30 to-gold/5 font-display text-2xl font-semibold text-gold">
                  {b.initials}
                </div>
                <h3 className="font-display text-xl font-semibold">{b.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{b.specialty}</p>
                <div className="mt-4 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{b.years} años</span>
                  <span className="flex items-center gap-1 text-gold">
                    <Star className="h-3 w-3 fill-current" /> {b.rating}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SERVICIOS */}
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <p className="mb-2 text-xs uppercase tracking-widest text-gold">Servicios</p>
          <h2 className="mb-12 font-display text-4xl font-semibold">Todo lo que necesitás</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.slice(0, 9).map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-5 py-4 transition hover:border-gold/30">
                <div className="flex items-center gap-3">
                  <Scissors className="h-4 w-4 text-gold" />
                  <div>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.duration} min</div>
                  </div>
                </div>
                <div className="font-display text-lg font-semibold text-gold">${s.price.toLocaleString("es-AR")}</div>
              </div>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Button asChild size="lg" className="bg-gold text-primary-foreground hover:bg-gold-soft">
              <Link to="/book">Reservar ahora</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/50 py-10 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Atelier Barber Co. — Av. Corrientes 1234, Buenos Aires
      </footer>

      <WhatsappButton />
    </div>
  );
}
