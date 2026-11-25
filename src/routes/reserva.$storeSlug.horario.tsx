import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/reserva/$storeSlug/horario")({
  component: () => null,
});
