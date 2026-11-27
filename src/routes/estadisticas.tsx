import { createFileRoute } from "@tanstack/react-router";
import { AdminPage } from "./admin";
import { noIndexMeta } from "@/lib/seo";

export const Route = createFileRoute("/estadisticas")({
  head: () => ({ meta: [{ title: "Estadísticas" }, noIndexMeta] }),
  component: AdminPage,
});
