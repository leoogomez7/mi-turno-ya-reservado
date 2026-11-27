import { createFileRoute } from "@tanstack/react-router";
import { ProfessionalsManager } from "./-professionals";
import { noIndexMeta } from "@/lib/seo";

export const Route = createFileRoute("/profesionales")({
  head: () => ({ meta: [{ title: "Configuración" }, noIndexMeta] }),
  component: ProfessionalsManager,
});
