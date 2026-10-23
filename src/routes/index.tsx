import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { LoadingScreen } from "@/components/loading-screen";
import { useAppAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: RootRedirect,
});

function RootRedirect() {
  const { isAuthenticated, isLoading, role } = useAppAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading || (isAuthenticated && !role)) return;

    const returnPath = window.sessionStorage.getItem("kinde-auth-return-path");
    window.sessionStorage.removeItem("kinde-auth-return-path");

    if (isAuthenticated && role === "admin") void navigate({ to: "/estadisticas", replace: true });
    else if (isAuthenticated && role === "client") void navigate({ to: "/reserva", replace: true });
    else if (returnPath === "/admin" || returnPath === "/estadisticas") void navigate({ to: "/estadisticas", replace: true });
    else if (returnPath === "/agenda") void navigate({ to: "/agenda", replace: true });
    else if (returnPath === "/configuracion" || returnPath === "/profesionales") void navigate({ to: "/configuracion", replace: true });
    else if (returnPath === "/mis-turnos") void navigate({ to: "/mis-turnos", replace: true });
    else void navigate({ to: "/reserva", replace: true });
  }, [isAuthenticated, isLoading, navigate, role]);

  return <LoadingScreen message="Finalizando el inicio de sesión…" />;
}
