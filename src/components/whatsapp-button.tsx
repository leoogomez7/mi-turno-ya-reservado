import { MessageCircle } from "lucide-react";
import { BUSINESS } from "@/lib/salon-data";

export function WhatsappButton() {
  const href = `https://wa.me/${BUSINESS.whatsapp}?text=${encodeURIComponent("Hola, quiero consultar sobre un turno.")}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Contactar por WhatsApp"
      className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25d366] text-white shadow-elevated transition-transform hover:scale-110"
    >
      <MessageCircle className="h-7 w-7" />
    </a>
  );
}
