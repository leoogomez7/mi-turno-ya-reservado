import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { LoadingScreen } from "@/components/loading-screen";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { useAppAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  component: RootRedirect,
});

function RootRedirect() {
  const { isAuthenticated, isLoading, role } = useAppAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading || !isAuthenticated || !role) return;

    const returnPath = window.sessionStorage.getItem("kinde-auth-return-path");
    window.sessionStorage.removeItem("kinde-auth-return-path");

    if (role === "admin" && returnPath === "/agenda")
      void navigate({ to: "/agenda", replace: true });
    else if (role === "admin" && (returnPath === "/admin" || returnPath === "/estadisticas"))
      void navigate({ to: "/estadisticas", replace: true });
    else if (role === "admin") void navigate({ to: "/configuracion", replace: true });
    else if (role === "client" && returnPath?.startsWith("/reserva/"))
      void navigate({ to: returnPath as never, replace: true });
    else if (role === "client" && returnPath === "/mis-datos")
      void navigate({ to: "/mis-datos", replace: true });
    else if (role === "client") void navigate({ to: "/mis-turnos", replace: true });
  }, [isAuthenticated, isLoading, navigate, role]);

  if (isLoading || isAuthenticated)
    return <LoadingScreen message="Finalizando el inicio de sesión…" />;

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center justify-center px-4 py-12">
        <section className="w-full max-w-2xl rounded-3xl border border-gold/30 bg-card p-8 text-center shadow-2xl sm:p-12">
          <p className="text-xs uppercase tracking-[0.3em] text-gold">Mi Turno Ya Reservado</p>
          <h1 className="mt-3 font-display text-3xl font-semibold sm:text-4xl">
            Gestioná o consultá tus turnos
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
            Ingresá o creá una cuenta. Para reservar, abrí el enlace de la sucursal que querés
            visitar.
          </p>
          <Button
            type="button"
            className="mt-7 bg-gold text-primary-foreground hover:bg-gold-soft"
            onClick={() => window.dispatchEvent(new Event("mi-turno-ya:open-auth-dialog"))}
          >
            Ingresar o crear cuenta
          </Button>
        </section>
      </main>
    </div>
  );
}
