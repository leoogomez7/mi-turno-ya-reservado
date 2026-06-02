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
  category: "corte" | "barba" | "color" | "tratamiento";
}

export const BARBERS: Barber[] = [
  { id: "juan", name: "Juan Martínez", specialty: "Especialista en fades", years: 8, rating: 4.9, initials: "JM" },
  { id: "lucas", name: "Lucas Gómez", specialty: "Especialista en barba", years: 6, rating: 4.8, initials: "LG" },
  { id: "matias", name: "Matías Fernández", specialty: "Cortes clásicos", years: 12, rating: 5.0, initials: "MF" },
  { id: "diego", name: "Diego Ruiz", specialty: "Coloración y estilo", years: 5, rating: 4.7, initials: "DR" },
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
];

export const BUSINESS = {
  name: "Atelier Barber Co.",
  address: "Av. Corrientes 1234, Buenos Aires",
  phone: "+54 11 5555-5555",
  whatsapp: "5491155555555",
  email: "turnos@atelierbarber.com",
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
