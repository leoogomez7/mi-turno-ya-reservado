import { createFileRoute } from "@tanstack/react-router";
import { noIndexMeta } from "@/lib/seo";

export const Route = createFileRoute("/reserva/profesional")({
  head: () => ({ meta: [noIndexMeta] }),
  component: () => null,
});
