import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/reserva/$storeSlug/$storeCode/profesional")({
  component: () => null,
});
