import { createFileRoute } from "@tanstack/react-router";
import { AgendaManager } from "@/components/agenda-manager";
import { noIndexMeta } from "@/lib/seo";

export const Route = createFileRoute("/agenda")({
  head: () => ({ meta: [{ title: "Agenda" }, noIndexMeta] }),
  component: AgendaManager,
});
