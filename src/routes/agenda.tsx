import { createFileRoute } from "@tanstack/react-router";
import { AgendaManager } from "@/components/agenda-manager";

export const Route = createFileRoute("/agenda")({
  head: () => ({ meta: [{ title: "Agenda" }] }),
  component: AgendaManager,
});
