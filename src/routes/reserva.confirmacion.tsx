import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/reserva/confirmacion")({
  beforeLoad: () => {
    throw redirect({ to: "/reserva" });
  },
  component: () => null,
});