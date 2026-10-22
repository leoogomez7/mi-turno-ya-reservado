import type { Booking } from "@/lib/booking-store";
import type { Professional } from "@/lib/professional-store";
import type { AccountRole } from "@/lib/auth";

type CloudSnapshot = { bookings: Booking[]; professionals: Professional[] };
export type Store = { code: string; name: string };
const SELECTED_STORE_KEY = "mi-turno-ya-selected-store";
let tokenGetter: (() => Promise<string | undefined>) | undefined;
let activeAccount: string | undefined;
let snapshot: CloudSnapshot = { bookings: [], professionals: [] };
let initialized = false;
let queuedWrites = Promise.resolve();
let storeCode = "GENERAL";
let availableStores: Store[] = [];

function cacheKey(account: string) {
  return `mi-turno-ya-cloud-cache:${encodeURIComponent(account.toLowerCase())}:${storeCode}`;
}

function dispatchCloudReady() {
  window.dispatchEvent(new Event("bookings:changed"));
  window.dispatchEvent(new Event("professionals:changed"));
  window.dispatchEvent(new Event("mi-turno-ya:cloud-ready"));
}

function setSnapshot(next: CloudSnapshot) {
  snapshot = {
    bookings: Array.isArray(next.bookings) ? next.bookings : [],
    professionals: Array.isArray(next.professionals) ? next.professionals : [],
  };
  initialized = true;
  dispatchCloudReady();
}

async function request<T>(method: "GET" | "PUT" | "POST", body?: unknown, requestedRole?: AccountRole): Promise<T> {
  const token = await tokenGetter?.();
  if (!token && method === "PUT") throw new Error("No se obtuvo una sesión válida de Kinde.");
  const response = await fetch("/api/data", {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(method === "GET" && token ? {
        "X-Requested-Role": requestedRole
          || sessionStorage.getItem("mi-turno-ya-requested-role")
          || (JSON.parse(localStorage.getItem("mi-turno-ya-account-role") || "null") as { role?: string } | null)?.role
          || "client",
        ...(sessionStorage.getItem("mi-turno-ya-admin-code") ? { "X-Admin-Invite-Code": sessionStorage.getItem("mi-turno-ya-admin-code")! } : {}),
      } : {}),
      "X-Store-Code": sessionStorage.getItem("mi-turno-ya-requested-store") || storeCode,
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

export async function bootstrapCloudData(account: string, getToken: () => Promise<string | undefined>, requestedRole?: AccountRole, requestedStore?: string) {
  activeAccount = account.trim().toLowerCase();
  tokenGetter = activeAccount === "guest" ? undefined : getToken;
  storeCode = requestedStore?.trim().toUpperCase()
    || localStorage.getItem(SELECTED_STORE_KEY)?.trim().toUpperCase()
    || "GENERAL";

  try {
    const cached = localStorage.getItem(cacheKey(activeAccount));
    if (cached) setSnapshot(JSON.parse(cached) as CloudSnapshot);
  } catch {
    localStorage.removeItem(cacheKey(activeAccount));
  }

  const result = await request<{ data: CloudSnapshot; role: "admin" | "client" | "guest"; storeCode: string | null; stores: Store[] }>("GET", undefined, requestedRole);
  storeCode = result.storeCode || storeCode;
  availableStores = result.stores ?? [];
  localStorage.setItem(SELECTED_STORE_KEY, storeCode);
  const cloudData = result.data ?? { bookings: [], professionals: [] };
  if (result.role === "admin" || result.role === "client") {
    const localBookings = JSON.parse(localStorage.getItem("salon_bookings_v1") || "[]") as Booking[];
    const localProfessionals = JSON.parse(localStorage.getItem("salon_professionals_v1") || "[]") as Professional[];
    const knownBookingIds = new Set(cloudData.bookings.map((booking) => booking.id));
    const bookingsToImport = localBookings.filter((booking) =>
      !booking.isTest
      && (booking.storeCode || "GENERAL") === storeCode
      && !knownBookingIds.has(booking.id)
      && (result.role === "admin" || booking.customer.email.trim().toLowerCase() === activeAccount),
    );
    if (bookingsToImport.length) {
      cloudData.bookings = bookingsToImport;
      await writeRecords("bookings", bookingsToImport);
    }
    if (result.role === "admin") {
      const knownProfessionalIds = new Set(cloudData.professionals.map((professional) => professional.id));
      const professionalsToImport = localProfessionals.filter((professional) =>
        !professional.isTest
        && (professional.storeCode || "GENERAL") === storeCode
        && !knownProfessionalIds.has(professional.id),
      );
      if (professionalsToImport.length) {
        cloudData.professionals = professionalsToImport;
        await writeRecords("professionals", professionalsToImport);
      }
    }
  }

  if (result.role === "guest") {
    const localBookings = JSON.parse(localStorage.getItem("salon_bookings_v1") || "[]") as Booking[];
    const cloudIds = new Set(cloudData.bookings.map((booking) => booking.id));
    cloudData.bookings = [...cloudData.bookings, ...localBookings.filter((booking) => !cloudIds.has(booking.id))];
  }

  setSnapshot(cloudData);
  localStorage.setItem(cacheKey(activeAccount), JSON.stringify(snapshot));
  sessionStorage.removeItem("mi-turno-ya-requested-role");
  sessionStorage.removeItem("mi-turno-ya-admin-code");
  sessionStorage.removeItem("mi-turno-ya-requested-store");
  return result.role;
}

export function clearCloudSession() {
  activeAccount = undefined;
  tokenGetter = undefined;
  snapshot = { bookings: [], professionals: [] };
  initialized = false;
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

export function persistCloudCollection(collection: "bookings" | "professionals", records: Array<Booking | Professional>) {
  if (!activeAccount || !initialized) return;
  if (!tokenGetter) {
    if (activeAccount === "guest" && collection === "bookings") {
      const newBookings = records.filter((record) => !snapshot.bookings.some((existing) => existing.id === record.id)) as Booking[];
      snapshot = { ...snapshot, bookings: records as Booking[] };
      localStorage.setItem(cacheKey(activeAccount), JSON.stringify(snapshot));
      for (const booking of newBookings) {
        void request("POST", { action: "guest-booking", booking }).catch((error: unknown) => {
          console.error("No se pudo enviar la reserva de invitado a la agenda", error);
          window.dispatchEvent(new CustomEvent("mi-turno-ya:cloud-error", {
            detail: error instanceof Error ? error.message : "No se pudo sincronizar la reserva.",
          }));
        });
      }
    }
    return;
  }
  const oldIds = new Set(snapshot[collection].map((record) => record.id));
  const nextIds = new Set(records.map((record) => record.id));
  const deleteIds = [...oldIds].filter((id) => !nextIds.has(id));
  snapshot = { ...snapshot, [collection]: records };
  localStorage.setItem(cacheKey(activeAccount), JSON.stringify(snapshot));
  dispatchCloudReady();
  const recordsCopy = records
    .filter((record) => collection !== "bookings" || (record as Booking).customer?.email?.trim().toLowerCase() === activeAccount)
    .map((record) => ({ ...record, storeCode }));
  const accountAtEnqueue = activeAccount;
  queuedWrites = queuedWrites
    .catch(() => undefined)
    .then(async () => {
      if (activeAccount !== accountAtEnqueue) return;
      await writeRecords(collection, recordsCopy, deleteIds);
    })
    .catch((error: unknown) => {
      console.error(`No se pudo guardar ${collection} en Turso`, error);
      window.dispatchEvent(new CustomEvent("mi-turno-ya:cloud-error", {
        detail: error instanceof Error ? error.message : "Error de sincronización.",
      }));
    });
}

export function getCurrentStoreCode() {
  return storeCode;
}

export function getAvailableStores() {
  return availableStores;
}

export async function selectStore(code: string, account: string, getToken?: () => Promise<string | undefined>, role?: AccountRole) {
  const nextCode = code.trim().toUpperCase();
  if (!availableStores.some((store) => store.code === nextCode)) throw new Error("No encontramos esa tienda.");
  localStorage.setItem(SELECTED_STORE_KEY, nextCode);
  await bootstrapCloudData(account, getToken ?? (async () => undefined), role, nextCode);
}

export async function createStore(name: string, code: string) {
  if (!tokenGetter) throw new Error("Iniciá sesión como administrador para crear una tienda.");
  const response = await request<{ store: Store }>("POST", { action: "create-store", store: { name, code: code.trim().toUpperCase() } });
  availableStores = [...availableStores.filter((store) => store.code !== response.store.code), response.store].sort((a, b) => a.name.localeCompare(b.name, "es"));
  storeCode = response.store.code;
  localStorage.setItem(SELECTED_STORE_KEY, storeCode);
  const adminAccount = activeAccount;
  const getToken = tokenGetter;
  if (adminAccount && getToken) {
    await bootstrapCloudData(adminAccount, getToken, "admin", storeCode);
  }
  window.dispatchEvent(new Event("mi-turno-ya:store-changed"));
  return response.store;
}

export async function createStoreAdminInvite() {
  if (!tokenGetter) throw new Error("Iniciá sesión como administrador para invitar a otra persona.");
  return request<{ code: string; storeCode: string }>("POST", { action: "create-store-invite" });
}