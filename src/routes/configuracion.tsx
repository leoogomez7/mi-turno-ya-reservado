import { createFileRoute } from "@tanstack/react-router";
import { ProfessionalsManager } from "./-professionals";

export const Route = createFileRoute("/configuracion")({
  head: () => ({ meta: [{ title: "Configuración" }] }),
  component: ProfessionalsManager,
});
