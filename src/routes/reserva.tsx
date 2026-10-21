import { createFileRoute } from "@tanstack/react-router";
import { BookPage } from "./book";

export const Route = createFileRoute("/reserva")({
  head: () => ({
    meta: [
      { title: "Reservar turno" },
      { name: "description", content: "Reservá tu turno en pocos pasos: elegí el rubro profesional, servicio, fecha y horario." },
    ],
  }),
  component: BookPage,
});
