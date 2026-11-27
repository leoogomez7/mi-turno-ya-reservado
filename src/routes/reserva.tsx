import { createFileRoute } from "@tanstack/react-router";
import { BookPage } from "./book";

export const Route = createFileRoute("/reserva")({
  head: () => ({
    meta: [
      { title: "Reservar turno" },
      {
        name: "description",
        content:
          "Buscá una sucursal, elegí el profesional y el servicio, y reservá fecha y horario para tu próximo turno.",
      },
      { property: "og:title", content: "Reservar turno online | Mi Turno Ya Reservado" },
      {
        property: "og:description",
        content: "Encontrá una sucursal y reservá tu turno online en pocos pasos.",
      },
    ],
    links: [{ rel: "canonical", href: "/reserva" }],
  }),
  component: BookPage,
});
