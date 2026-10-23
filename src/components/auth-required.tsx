import { useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { rememberAuthReturnPath, useAppAuth, type AccountRole } from "@/lib/auth";

export function AuthRequired({ role, title }: { role: AccountRole; title: string }) {
  const { configured, isLoading, login } = useAppAuth();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const description = role === "admin"
    ? "Iniciá sesión con una cuenta administradora autorizada para gestionar profesionales y turnos."
    : "Iniciá sesión como cliente para ver tus turnos reservados y su estado.";

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-6 py-12">
      <section className="w-full rounded-3xl border border-border bg-card p-8 text-center">
        <p className="text-xs uppercase tracking-widest text-gold">Acceso a tu cuenta</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {!configured ? "La autenticación Kinde todavía no está configurada. Revisá .env / .env.local y las variables de Vercel." : description}
        </p>
        {configured && (
          <Button className="mt-6 bg-gold text-primary-foreground hover:bg-gold-soft" disabled={isLoading || busy} onClick={async () => {
            setBusy(true);
            rememberAuthReturnPath(location.pathname);
            await login(role);
            setBusy(false);
          }}>
            {busy ? "Conectando…" : "Iniciar sesión"}
          </Button>
        )}
      </section>
    </main>
  );
}
