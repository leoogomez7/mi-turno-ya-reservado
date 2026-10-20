export interface Barber {
  id: string;
  name: string;
  specialty: string;
  years: number;
  rating: number;
  initials: string;
}

export interface Service {
  id: string;
  name: string;
  duration: number; // minutes
  price: number;
  category: "corte" | "barba" | "color" | "tratamiento" | "medico";
}

export const BARBERS: Barber[] = [
  { id: "peluquero", name: "Carlos López", specialty: "Peluquero", years: 10, rating: 4.9, initials: "CL" },
  { id: "medico", name: "Dra. Laura Medina", specialty: "Médico", years: 14, rating: 4.8, initials: "LM" },
];

export const SERVICES: Service[] = [
  { id: "corte-clasico", name: "Corte clásico", duration: 30, price: 8000, category: "corte" },
  { id: "fade", name: "Fade", duration: 40, price: 10000, category: "corte" },
  { id: "degradado", name: "Degradado", duration: 40, price: 10000, category: "corte" },
  { id: "tijera", name: "Corte con tijera", duration: 45, price: 11000, category: "corte" },
  { id: "infantil", name: "Corte infantil", duration: 30, price: 6500, category: "corte" },
  { id: "barba", name: "Barba", duration: 25, price: 6000, category: "barba" },
  { id: "perfilado", name: "Perfilado de barba", duration: 20, price: 5000, category: "barba" },
  { id: "afeitado", name: "Afeitado tradicional", duration: 30, price: 7000, category: "barba" },
  { id: "lavado", name: "Lavado", duration: 15, price: 3000, category: "tratamiento" },
  { id: "color", name: "Coloración", duration: 120, price: 25000, category: "color" },
  { id: "mechas", name: "Mechas", duration: 120, price: 28000, category: "color" },
  { id: "alisado", name: "Alisado", duration: 90, price: 22000, category: "tratamiento" },
  { id: "tratamiento", name: "Tratamiento capilar", duration: 60, price: 14000, category: "tratamiento" },
  { id: "peinado", name: "Peinado", duration: 30, price: 7500, category: "corte" },
  { id: "consulta-general", name: "Consulta general", duration: 30, price: 12000, category: "medico" },
  { id: "control-medico", name: "Control médico", duration: 40, price: 15000, category: "medico" },
  { id: "seguimiento", name: "Seguimiento de tratamiento", duration: 30, price: 11000, category: "medico" },
];

export const BUSINESS = {
  name: "Profesional",
  address: "Buenos Aires",
  phone: "+54 11 3296-5583",
  whatsapp: "5491132965583",
  email: "leorgomez7@gmail.com",
  hours: { open: 9, close: 20 }, // 9:00 - 20:00
  closedDays: [0], // Sunday
  slotMinutes: 30,
};

export function generateSlots(): string[] {
  const slots: string[] = [];
  for (let h = BUSINESS.hours.open; h < BUSINESS.hours.close; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}
