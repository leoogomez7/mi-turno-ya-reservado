import { createFileRoute } from "@tanstack/react-router";
import { AdminPage } from "./admin";

export const Route = createFileRoute("/estadisticas")({
  head: () => ({ meta: [{ title: "Estadísticas" }] }),
  component: AdminPage,
});
