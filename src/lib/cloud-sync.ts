import type { Booking } from "@/lib/booking-store";
import type { Professional } from "@/lib/professional-store";
import type { AccountRole } from "@/lib/auth";

type CloudSnapshot = { bookings: Booking[]; professionals: Professional[] };
export type StoreSettings = {
  address: string;
  street: string;
  height: string;
  city: string;
  province: string;
  postalCode: string;
  whatsapp: string;
  instagram: string;
  transferHolder: string;
  transferBank: string;
  transferCbu: string;
  transferAlias: string;
};
export type StoreContactSettings = Pick<StoreSettings, "street" | "height" | "city" | "province" | "postalCode" | "whatsapp" | "instagram">;
export type Store = {
  code: string;
  name: string;
  settings: StoreSettings;
  subscriptionExpiresAt?: string | null;
  subscriptionActive?: boolean;
  subscriptionPlanType?: "trial" | "paid" | "promo" | string;
};
let tokenGetter: (() => Promise<string | undefined>) | undefined;
let activeAccount: string | undefined;
let snapshot: CloudSnapshot = { bookings: [], professionals: [] };
let initialized = false;
let storeCode = "";
let availableStores: Store[] = [];

function dispatchCloudReady() {
  window.dispatchEvent(new Event("bookings:changed"));
  window.dispatchEvent(new Event("professionals:changed"));
  window.dispatchEvent(new Event("mi-turno-ya:cloud-ready"));
}

function setSnapshot(next: CloudSnapshot) {
  if (!next || !Array.isArray(next.bookings) || !Array.isArray(next.professionals)) {
    throw new Error("La base de datos devolvió una respuesta incompleta. No se cargaron datos locales.");
  }
  snapshot = next;
  initialized = true;
  dispatchCloudReady();
}

async function request<T>(method: "GET" | "PUT" | "POST", body?: unknown): Promise<T> {
  const token = await tokenGetter?.();
  if (!token && method === "PUT") throw new Error("No se obtuvo una sesión válida de Kinde.");
  const response = await fetch("/api/data", {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(storeCode ? { "X-Store-Code": storeCode } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "No se pudo sincronizar con la base de datos.");
  return result;
}

async function writeRecords(collection: "bookings" | "professionals", records: Array<Booking | Professional>, deleteIds: string[] = []) {
  for (let offset = 0; offset < records.length; offset += 100) {
    await request("PUT", {
      collection,
      records: records.slice(offset, offset + 100),
      ...(offset === 0 && deleteIds.length ? { deleteIds } : {}),
    });
  }
  if (records.length === 0 && deleteIds.length) {
    for (let offset = 0; offset < deleteIds.length; offset += 100) {
      await request("PUT", { collection, records: [], deleteIds: deleteIds.slice(offset, offset + 100) });
    }
  }
}

export async function bootstrapCloudData(account: string, getToken: () => Promise<string | undefined>, requestedStore?: string) {
  activeAccount = account.trim().toLowerCase();
  tokenGetter = activeAccount === "guest" ? undefined : getToken;
  storeCode = requestedStore?.trim().toUpperCase() || "";

  const result = await request<{ data: CloudSnapshot; role: "admin" | "client" | "guest" | "unassigned"; storeCode: string | null; stores: Store[] }>("GET");
  if (!result.data || !Array.isArray(result.stores)) throw new Error("La base de datos devolvió una respuesta incompleta.");
  const loadedStoreCode = storeCode || result.storeCode || "";
  storeCode = loadedStoreCode;
  availableStores = result.stores;
  setSnapshot(result.data);
  return result.role;
}

export function clearCloudSession() {
  activeAccount = undefined;
  tokenGetter = undefined;
  snapshot = { bookings: [], professionals: [] };
  initialized = false;
  storeCode = "";
  dispatchCloudReady();
}

export function getCloudRecords(collection: "bookings"): Booking[];
export function getCloudRecords(collection: "professionals"): Professional[];
export function getCloudRecords(collection: "bookings" | "professionals") {
  return snapshot[collection];
}

export function isCloudReady() {
  return initialized && activeAccount !== "guest" && Boolean(tokenGetter);
}

export function isCloudInitialized() {
  return initialized;
}

export async function persistCloudCollection(collection: "bookings" | "professionals", records: Array<Booking | Professional>) {
  if (!activeAccount || !initialized) throw new Error("La base todavía no está cargada. Reintentá en unos segundos.");
  if (!tokenGetter) {
    if (activeAccount === "guest" && collection === "bookings") {
      const booking = records[records.length - 1] as Booking | undefined;
      if (!booking) return;
      await request("POST", { action: "guest-booking", booking: { ...booking, storeCode } });
      const result = await request<{ data: CloudSnapshot; stores: Store[] }>("GET");
      if (!result.data || !Array.isArray(result.stores)) throw new Error("La base de datos devolvió una respuesta incompleta.");
      availableStores = result.stores;
      setSnapshot(result.data);
      return;
    }
    throw new Error("Iniciá sesión para guardar cambios en la base de datos.");
  }
  const oldIds = new Set(snapshot[collection].map((record) => record.id));
  const nextIds = new Set(records.map((record) => record.id));
  const deleteIds = [...oldIds].filter((id) => !nextIds.has(id));
  const recordsCopy = records
    .filter((record) => collection !== "bookings" || (record as Booking).customer?.email?.trim().toLowerCase() === activeAccount)
    .map((record) => ({ ...record, storeCode }));
  const accountAtWrite = activeAccount;
  await writeRecords(collection, recordsCopy, deleteIds);
  if (activeAccount !== accountAtWrite) throw new Error("Cambió la cuenta activa; vuelve a cargar los datos.");
  const result = await request<{ data: CloudSnapshot; stores: Store[] }>("GET");
  if (!result.data || !Array.isArray(result.stores)) throw new Error("La base de datos devolvió una respuesta incompleta.");
  availableStores = result.stores;
  setSnapshot(result.data);
}

export function getCurrentStoreCode() {
  return storeCode;
}

export function getAvailableStores() {
  return availableStores;
}

export async function selectStore(code: string, account: string, getToken?: () => Promise<string | undefined>) {
  const nextCode = code.trim().toUpperCase();
  if (!availableStores.some((store) => store.code === nextCode)) throw new Error("No encontramos esa sucursal.");
  storeCode = nextCode;
  await bootstrapCloudData(account, getToken ?? (async () => undefined), nextCode);
}

export async function createStore(name: string, code: string) {
  if (!tokenGetter) throw new Error("Iniciá sesión como administrador para guardar una sucursal.");
  const previousCode = storeCode;
  const response = await request<{ store: Store; previousCode: string }>("POST", { action: "create-store", store: { name, code: code.trim().toUpperCase() } });
  availableStores = [...availableStores.filter((store) => store.code !== response.previousCode && store.code !== response.store.code), response.store].sort((a, b) => a.name.localeCompare(b.name, "es"));
  storeCode = response.store.code;
  if (previousCode && previousCode !== storeCode) {
    snapshot = {
      bookings: snapshot.bookings.map((booking) => ({ ...booking, storeCode })),
      professionals: snapshot.professionals.map((professional) => ({ ...professional, storeCode })),
    };
  }
  initialized = true;
  window.dispatchEvent(new Event("bookings:changed"));
  window.dispatchEvent(new Event("professionals:changed"));
  window.dispatchEvent(new Event("mi-turno-ya:store-changed"));
  return response.store;
}

export async function saveAccountRole(role: AccountRole) {
  if (!tokenGetter || !activeAccount) throw new Error("Iniciá sesión antes de configurar tu cuenta.");
  const saved = await request<{ role: AccountRole; storeCode: string | null }>("POST", {
    action: "set-account-role",
    role,
  });
  storeCode = saved.storeCode ?? "";
  await bootstrapCloudData(activeAccount, tokenGetter, storeCode || undefined);
  return saved;
}

export async function updateStoreSettings(settings: StoreSettings) {
  if (!tokenGetter) throw new Error("Iniciá sesión como administrador para editar los datos de la sucursal.");
  const response = await request<{ code: string; settings: StoreSettings }>("POST", { action: "update-store-settings", settings });
  availableStores = availableStores.map((store) => store.code === response.code ? { ...store, settings: response.settings } : store);
  window.dispatchEvent(new Event("mi-turno-ya:store-changed"));
  return response.settings;
}

export async function updateStoreContact(contact: StoreContactSettings) {
  if (!tokenGetter) throw new Error("Iniciá sesión como administrador para editar los datos de contacto.");
  const response = await request<{ code: string; settings: StoreSettings }>("POST", { action: "update-store-contact", contact });
  availableStores = availableStores.map((store) => store.code === response.code ? { ...store, settings: response.settings } : store);
  window.dispatchEvent(new Event("mi-turno-ya:store-changed"));
  return response.settings;
}

export async function createSubscriptionCheckout(planId: string) {
  if (!tokenGetter) throw new Error("Iniciá sesión como administrador para contratar un plan.");
  return request<{ checkoutUrl: string; purchaseId: string }>("POST", { action: "create-subscription-checkout", planId });
}

export async function redeemSubscriptionPromo(code: string, planId: string) {
  if (!tokenGetter) throw new Error("Iniciá sesión como administrador para canjear una promoción.");
  return request<{ expiresAt: string; planLabel: string }>("POST", { action: "redeem-subscription-promo", code, planId });
}

export async function verifySubscriptionPayment(purchaseId: string) {
  if (!tokenGetter) throw new Error("Iniciá sesión como administrador para verificar el pago.");
  return request<{ approved: boolean; expiresAt?: string | null }>("POST", { action: "verify-subscription-payment", purchaseId });
}