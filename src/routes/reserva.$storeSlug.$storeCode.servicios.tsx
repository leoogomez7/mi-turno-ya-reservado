import { createFileRoute } from "@tanstack/react-router";
import { noIndexMeta } from "@/lib/seo";

export const Route = createFileRoute("/reserva/$storeSlug/$storeCode/servicios")({
  head: () => ({ meta: [noIndexMeta] }),
  component: () => null,
});
