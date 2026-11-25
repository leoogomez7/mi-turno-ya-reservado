import type { AccountRole } from "@/lib/auth-context";

export function rememberAuthReturnPath(path: string) {
  if (typeof window === "undefined") return;
  const allowedPaths = [
    "/admin",
    "/agenda",
    "/estadisticas",
    "/plan",
    "/configuracion",
    "/profesionales",
    "/mis-turnos",
    "/mis-datos",
    "/reserva",
  ];
  if (allowedPaths.includes(path)) {
    window.sessionStorage.setItem("kinde-auth-return-path", path);
  }
}

export function rememberSignupRole(role: AccountRole) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem("kinde-signup-role", role);
  window.sessionStorage.setItem(
    "kinde-auth-return-path",
    role === "admin" ? "/configuracion" : "/reserva",
  );
}
