import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { getAvailableStores, getCurrentStoreCode } from "@/lib/cloud-sync";

export function WhatsappButton() {
  const [whatsapp, setWhatsapp] = useState("");
  useEffect(() => {
    const update = () => {
      const store = getAvailableStores().find((item) => item.code === getCurrentStoreCode());
      setWhatsapp(store?.settings.whatsapp?.replace(/\D/g, "") ?? "");
    };
    update();
    window.addEventListener("mi-turno-ya:cloud-ready", update);
    window.addEventListener("mi-turno-ya:store-changed", update);
    return () => {
      window.removeEventListener("mi-turno-ya:cloud-ready", update);
      window.removeEventListener("mi-turno-ya:store-changed", update);
    };
  }, []);
  if (!whatsapp) return null;
  const href = `https://wa.me/${whatsapp}?text=${encodeURIComponent("Hola, quiero consultar sobre un turno.")}`;
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
