import { createFileRoute, Link } from "@tanstack/react-router";
import { Calendar, Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { WhatsappButton } from "@/components/whatsapp-button";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mi Turno Ya" },
      { name: "description", content: "Reservá tu turno en segundos. Elegí rubro del profesional y reservá en segundos." },
      { property: "og:title", content: "Mi Turno Ya" },
      { property: "og:description", content: "Reservá tu turno en segundos. Elegí rubro del profesional y reservá en segundos." },
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
          <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
            Reservá tu turno
            <br />
            <span className="text-gradient-gold">online</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Tu turno listo en un clic.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-14 bg-gold px-10 text-base font-semibold text-primary-foreground shadow-gold hover:bg-gold-soft">
              <Link to="/book"><Calendar className="mr-2 h-5 w-5" /> RESERVAR TURNO</Link>
            </Button>
          </div>

        </div>
      </section>

      <footer className="border-t border-border/50 py-10 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Reservá turno.
      </footer>

      <WhatsappButton />
    </div>
  );
}
