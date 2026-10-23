import { createFileRoute } from "@tanstack/react-router";
import { ProfessionalsManager } from "./-professionals";

export const Route = createFileRoute("/profesionales")({
  head: () => ({ meta: [{ title: "Configuración" }] }),
  component: ProfessionalsManager,
});