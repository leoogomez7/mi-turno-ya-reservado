import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeWhatsappNumber(value: string) {
  let digits = value.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("549")) return digits;
  if (digits.startsWith("54")) return `549${digits.slice(2).replace(/^9/, "")}`;

  digits = digits.replace(/^0+/, "");
  if (digits.length >= 12 && digits.startsWith("11") && digits.slice(2).startsWith("15")) {
    digits = `${digits.slice(0, 2)}${digits.slice(4)}`;
  }
  return `549${digits}`;
}
