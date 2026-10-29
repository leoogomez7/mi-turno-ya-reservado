import { createClient } from "@libsql/client";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";

const COLLECTIONS = ["bookings", "professionals"];
const FREE_TRIAL_DAYS = 4;
const SUBSCRIPTION_PLANS = new Map([
  ["15d", { days: 15, months: 0, amount: 5999, label: "15 días" }],
  ["1m", { days: 0, months: 1, amount: 9999, label: "1 mes" }],
  ["2m", { days: 0, months: 2, amount: 14999, label: "2 meses" }],
  ["3m", { days: 0, months: 3, amount: 19999, label: "3 meses" }],
  ["4m", { days: 0, months: 4, amount: 25999, label: "4 meses" }],
  ["6m", { days: 0, months: 6, amount: 36999, label: "6 meses" }],
]);
let schemaReady;
let legacyInvitesRemoved = false;
let demoStoreRemoved = false;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta configurar ${name} en el servidor.`);
  return value;
}

function normalizeStoreCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function storedRecordId(storeCode, id) {
  return `${storeCode}:${id}`;
}

async function ensureRoleStoreColumn(db) {
  const columns = await db.execute("PRAGMA table_info(account_roles)");
  if (!columns.rows.some((column) => column.name === "store_code")) {
    await db.execute("ALTER TABLE account_roles ADD COLUMN store_code TEXT");
  }
}

async function ensureStoreSettingsColumn(db) {
  const columns = await db.execute("PRAGMA table_info(stores)");
  if (!columns.rows.some((column) => column.name === "settings")) {
    await db.execute("ALTER TABLE stores ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'");
  }
}

async function ensureStoreSubscriptionColumn(db) {
  const columns = await db.execute("PRAGMA table_info(stores)");
  if (!columns.rows.some((column) => column.name === "subscription_expires_at")) {
    await db.execute("ALTER TABLE stores ADD COLUMN subscription_expires_at TEXT");
  }
  if (!columns.rows.some((column) => column.name === "subscription_trial_started_at")) {
    await db.execute("ALTER TABLE stores ADD COLUMN subscription_trial_started_at TEXT");
  }
  if (!columns.rows.some((column) => column.name === "subscription_plan_type")) {
    await db.execute("ALTER TABLE stores ADD COLUMN subscription_plan_type TEXT");
  }
}

async function ensureSubscriptionOrderDurationColumn(db) {
  const columns = await db.execute("PRAGMA table_info(subscription_orders)");
  if (!columns.rows.some((column) => column.name === "duration_days")) {
    await db.execute("ALTER TABLE subscription_orders ADD COLUMN duration_days INTEGER");
  }
}

async function removeDemoStore(db) {
  if (demoStoreRemoved) return;
  const transaction = await db.transaction("write");
  try {
    const demoStores = await transaction.execute({
      sql: "SELECT code FROM stores WHERE code = ? OR owner_id = ?",
      args: ["GENERAL", "legacy"],
    });
    const codes = demoStores.rows.map((row) => String(row.code));
    if (codes.length) {
      const placeholders = codes.map(() => "?").join(", ");
      await transaction.execute({
        sql: `DELETE FROM subscription_orders WHERE store_code IN (${placeholders})`,
        args: codes,
      });
      await transaction.execute({
        sql: `DELETE FROM bookings WHERE upper(json_extract(value, '$.storeCode')) IN (${placeholders})`,
        args: codes,
      });
      const professionalRows = await transaction.execute("SELECT id, value FROM professionals");
      for (const row of professionalRows.rows) {
        const professional = JSON.parse(String(row.value));
        const code = normalizeStoreCode(professional.storeCode);
        if (codes.includes(code) || codes.some((demoCode) => String(row.id).startsWith(`${demoCode}:`))) {
          await transaction.execute({ sql: "DELETE FROM professionals WHERE id = ?", args: [String(row.id)] });
        }
      }
      await transaction.execute({
        sql: `UPDATE account_roles SET store_code = NULL WHERE store_code IN (${placeholders})`,
        args: codes,
      });
      await transaction.execute({
        sql: `DELETE FROM stores WHERE code IN (${placeholders})`,
        args: codes,
      });
    }
    await transaction.commit();
    demoStoreRemoved = true;
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}

function parseStoreSettings(value) {
  try {
    const settings = JSON.parse(String(value || "{}"));
    const source = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
    const street = typeof source.street === "string" ? source.street : typeof source.address === "string" ? source.address : "";
    const height = typeof source.height === "string" ? source.height : "";
    const city = typeof source.city === "string" ? source.city : "";
    const province = typeof source.province === "string" ? source.province : "";
    const postalCode = typeof source.postalCode === "string" ? source.postalCode : "";
    const address = [street, height, city, province, postalCode].filter(Boolean).join(", ");
    return {
      address: address || (typeof source.address === "string" ? source.address : ""),
      street,
      height,
      city,
      province,
      postalCode,
      whatsapp: typeof source.whatsapp === "string" ? source.whatsapp : "",
      instagram: typeof source.instagram === "string" ? source.instagram : "",
      transferHolder: typeof source.transferHolder === "string" ? source.transferHolder : "",
      transferBank: typeof source.transferBank === "string" ? source.transferBank : "",
      transferCbu: typeof source.transferCbu === "string" ? source.transferCbu : "",
      transferAlias: typeof source.transferAlias === "string" ? source.transferAlias : "",
    };
  } catch {
    return { address: "", street: "", height: "", city: "", province: "", postalCode: "", whatsapp: "", instagram: "", transferHolder: "", transferBank: "", transferCbu: "", transferAlias: "" };
  }
}

function validateStoreSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields = ["street", "height", "city", "province", "postalCode", "whatsapp", "instagram", "transferHolder", "transferBank", "transferCbu", "transferAlias"];
  const settings = {};
  for (const field of fields) {
    const setting = value[field] ?? "";
    const maxLength = field === "street" ? 150 : field === "height" || field === "postalCode" ? 20 : field === "whatsapp" ? 25 : field === "instagram" ? 100 : 200;
    if (typeof setting !== "string" || setting.length > maxLength) return null;
    settings[field] = setting.trim();
  }
  if (settings.whatsapp && !/^\+?[0-9 ()-]{8,25}$/.test(settings.whatsapp)) return null;
  settings.address = [settings.street, settings.height, settings.city, settings.province, settings.postalCode].filter(Boolean).join(", ");
  return settings;
}

function normalizeIssuer() {
  const issuer = requiredEnv("KINDE_ISSUER_URL").replace(/\/+$/, "");
  return /^https?:\/\//i.test(issuer) ? issuer : `https://${issuer}`;
}

async function verifyUser(request) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  const issuer = normalizeIssuer();
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`));
  try {
    const { payload } = await jwtVerify(authorization.slice(7), jwks, {
      issuer,
      audience: requiredEnv("KINDE_CLIENT_ID"),
      requiredClaims: ["sub", "exp", "iat"],
    });
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!payload.sub || !email) return null;
    return { id: String(payload.sub), email, emailVerified: payload.email_verified === true };
  } catch {
    return null;
  }
}

async function database() {
  const db = createClient({ url: requiredEnv("TURSO_DATABASE_URL"), authToken: requiredEnv("TURSO_AUTH_TOKEN") });
  schemaReady ??= db.batch([
    `CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS professionals (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS account_roles (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'client')),
      store_code TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS stores (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscription_orders (
      id TEXT PRIMARY KEY,
      store_code TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      months INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      duration_days INTEGER,
      status TEXT NOT NULL CHECK(status IN ('pending', 'paid', 'failed')),
      method TEXT NOT NULL CHECK(method IN ('mercadopago', 'promo')),
      mp_payment_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paid_at TEXT
    )`,
    "CREATE INDEX IF NOT EXISTS bookings_updated ON bookings(updated_at)",
    "CREATE INDEX IF NOT EXISTS subscription_orders_store ON subscription_orders(store_code, created_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS subscription_orders_payment ON subscription_orders(mp_payment_id) WHERE mp_payment_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS professionals_updated ON professionals(updated_at)",
  ]).then(() => undefined).catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  await schemaReady;
  await ensureRoleStoreColumn(db);
  await ensureStoreSettingsColumn(db);
  await ensureStoreSubscriptionColumn(db);
  await ensureSubscriptionOrderDurationColumn(db);
  await removeDemoStore(db);
  if (!legacyInvitesRemoved) {
    await db.execute("DROP TABLE IF EXISTS admin_invites");
    legacyInvitesRemoved = true;
  }
  return db;
}

function parseBody(body) {
  if (typeof body === "string") return JSON.parse(body);
  return body;
}

function addSubscriptionMonths(dateValue, months) {
  const date = new Date(dateValue);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

function addSubscriptionDays(dateValue, days) {
  const date = new Date(dateValue);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

async function activateFreeTrial(db, storeCode) {
  const startedAt = new Date().toISOString();
  const expiresAt = addSubscriptionDays(startedAt, FREE_TRIAL_DAYS);
  await db.execute({
    sql: `UPDATE stores
      SET subscription_expires_at = ?, subscription_trial_started_at = ?, subscription_plan_type = 'trial'
      WHERE code = ? AND subscription_expires_at IS NULL AND subscription_trial_started_at IS NULL`,
    args: [expiresAt, startedAt, storeCode],
  });
}

function isSubscriptionActive(expiresAt) {
  return typeof expiresAt === "string" && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) > Date.now();
}

export function subscriptionPromoDiscountPercent(code) {
  const normalizedCode = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!normalizedCode) return 0;

  const discountCodes = (process.env.DESCUENTO_OFF ?? "")
    .split(",")
    .map((configuredCode) => configuredCode.trim().toUpperCase())
    .filter(Boolean);
  if (discountCodes.includes(normalizedCode)) return 10;

  const freeCodes = (process.env.GRATIS2026 ?? "")
    .split(",")
    .map((configuredCode) => configuredCode.trim().toUpperCase())
    .filter(Boolean);
  if (freeCodes.includes(normalizedCode)) return 100;

  return 0;
}

async function verifyMercadoPagoPayment(db, paymentId, expectedOwnerId) {
  if (!/^\d{1,30}$/.test(String(paymentId))) throw new Error("Identificador de pago inválido.");
  const accessToken = requiredEnv("MERCADOPAGO_ACCESS_TOKEN");
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("No se pudo verificar el pago en Mercado Pago.");
  const payment = await response.json();
  if (payment.status !== "approved") return { approved: false };
  if (payment.currency_id !== "ARS") throw new Error("La moneda del pago no coincide con ARS.");
  const purchaseId = typeof payment.external_reference === "string" ? payment.external_reference : "";
  if (!purchaseId) throw new Error("El pago no está asociado a una compra de suscripción.");

  const transaction = await db.transaction("write");
  try {
    const result = await transaction.execute({
      sql: "SELECT id, store_code, owner_id, months, duration_days, amount, status FROM subscription_orders WHERE id = ? AND method = 'mercadopago'",
      args: [purchaseId],
    });
    const order = result.rows[0];
    if (!order) throw new Error("No encontramos la compra de suscripción asociada al pago.");
    if (expectedOwnerId && String(order.owner_id) !== expectedOwnerId) throw new Error("El pago no corresponde a tu cuenta.");
    if (Number(payment.transaction_amount) !== Number(order.amount)) throw new Error("El importe pagado no coincide con el plan.");
    if (order.status === "paid") {
      const store = await transaction.execute({ sql: "SELECT subscription_expires_at FROM stores WHERE code = ?", args: [String(order.store_code)] });
      await transaction.commit();
      return { approved: true, expiresAt: store.rows[0]?.subscription_expires_at ?? null };
    }
    if (order.status !== "pending") throw new Error("La compra de suscripción no está pendiente.");

    const storeResult = await transaction.execute({ sql: "SELECT subscription_expires_at FROM stores WHERE code = ?", args: [String(order.store_code)] });
    if (!storeResult.rows[0]) throw new Error("No encontramos la sucursal de esta suscripción.");
    const currentExpiry = String(storeResult.rows[0].subscription_expires_at ?? "");
    const startDate = currentExpiry && Date.parse(currentExpiry) > Date.now() ? currentExpiry : new Date().toISOString();
    const expiresAt = Number(order.duration_days) > 0
      ? addSubscriptionDays(startDate, Number(order.duration_days))
      : addSubscriptionMonths(startDate, Number(order.months));
    await transaction.execute({
      sql: "UPDATE stores SET subscription_expires_at = ?, subscription_plan_type = 'paid' WHERE code = ?",
      args: [expiresAt, String(order.store_code)],
    });
    await transaction.execute({
      sql: "UPDATE subscription_orders SET status = 'paid', mp_payment_id = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
      args: [String(payment.id), purchaseId],
    });
    await transaction.commit();
    return { approved: true, expiresAt };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}

async function verifySubscriptionPurchase(db, purchaseId, expectedOwnerId) {
  if (typeof purchaseId !== "string" || !/^[a-f0-9]{36}$/.test(purchaseId)) throw new Error("Identificador de compra inválido.");
  const accessToken = requiredEnv("MERCADOPAGO_ACCESS_TOKEN");
  const response = await fetch(`https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(purchaseId)}&sort=date_created&criteria=desc`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("No se pudo consultar el estado del pago en Mercado Pago.");
  const result = await response.json();
  const approvedPayment = result.results?.find((payment) => payment.status === "approved");
  if (!approvedPayment) return { approved: false };
  return verifyMercadoPagoPayment(db, String(approvedPayment.id), expectedOwnerId);
}

function recordId(record) {
  return record && typeof record === "object" && !Array.isArray(record)
    && typeof record.id === "string" && record.id.length > 0 && record.id.length <= 200
    ? record.id : null;
}

function scheduleForDate(professional, date) {
  const override = professional.scheduleDates?.find((entry) => entry.date === date);
  if (override) return override;
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (!professional.weeklySchedule?.length) return null;
  return professional.weeklySchedule.find((entry) => entry.dayOfWeek === dayOfWeek)
    ?? { date, start: "", end: "", closed: true };
}

function bookingCapacityForDate(professional, date) {
  const schedule = scheduleForDate(professional, date);
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
  const weeklySchedule = professional.weeklySchedule?.find((entry) => entry.dayOfWeek === dayOfWeek);
  const capacity = Number(schedule?.capacity ?? weeklySchedule?.capacity ?? 1);
  return Number.isInteger(capacity) && capacity >= 1 && capacity <= 20 ? capacity : 1;
}

function scheduleSlots(schedule) {
  const start = /^([0-2]\d):([0-5]\d)$/.exec(schedule.start);
  const end = /^([0-2]\d):([0-5]\d)$/.exec(schedule.end);
  if (!start || !end) return null;
  const firstMinute = Number(start[1]) * 60 + Number(start[2]);
  const endMinute = Number(end[1]) * 60 + Number(end[2]);
  const slots = [];
  for (let minute = firstMinute; minute + 15 <= endMinute; minute += 15) {
    slots.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  }
  return { slots, endMinute };
}

async function hasBookingConflict(db, booking, storeCode, capacity = 1, bookingId = "") {
  const existingResult = await db.execute("SELECT id, value FROM bookings");
  const [hours, minutes] = String(booking.time).split(":").map(Number);
  const startMinute = hours * 60 + minutes;
  const existingBookings = existingResult.rows.map((row) => {
    const existing = JSON.parse(String(row.value));
    if (normalizeStoreCode(existing.storeCode) !== storeCode || existing.id === bookingId) return null;
    if (existing.barberId !== booking.barberId || existing.date !== booking.date || existing.status === "cancelled") return null;
    const [existingHours, existingMinutes] = String(existing.time).split(":").map(Number);
    const existingStart = existingHours * 60 + existingMinutes;
    return { start: existingStart, end: existingStart + Number(existing.duration) };
  }).filter(Boolean);
  const bookingEnd = startMinute + Number(booking.duration);
  for (let minute = startMinute; minute < bookingEnd; minute += 15) {
    const overlapping = existingBookings.filter((existing) => minute < existing.end && existing.start < minute + 15).length;
    if (overlapping >= capacity) return true;
  }
  return false;
}

async function validateBookingAvailability(db, booking, storeCode, bookingId = "") {
  const storeResult = await db.execute({ sql: "SELECT subscription_expires_at FROM stores WHERE code = ?", args: [storeCode] });
  if (!storeResult.rows[0] || !isSubscriptionActive(storeResult.rows[0].subscription_expires_at)) {
    return "La sucursal no tiene un plan activo para aceptar reservas.";
  }
  const validDate = typeof booking.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(booking.date);
  const parsedDate = validDate ? new Date(`${booking.date}T12:00:00Z`) : null;
  const todayInArgentina = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== booking.date || booking.date < todayInArgentina) {
    return "La fecha del turno no es válida.";
  }
  if (typeof booking.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(booking.time)) return "La hora del turno no es válida.";
  if (!Array.isArray(booking.serviceIds) || booking.serviceIds.length === 0 || booking.serviceIds.length > 20) return "La selección de servicios no es válida.";
  if (!Number.isFinite(booking.duration) || booking.duration <= 0 || !Number.isFinite(booking.totalPrice) || booking.totalPrice < 0) {
    return "El precio o la duración del turno no son válidos.";
  }

  const professionalResult = await db.execute({ sql: "SELECT value FROM professionals WHERE id = ?", args: [storedRecordId(storeCode, booking.barberId)] });
  if (!professionalResult.rows[0]) return "El profesional elegido ya no está disponible.";
  const professional = JSON.parse(String(professionalResult.rows[0].value));
  if (professional.isTest) return "No se pueden reservar turnos de prueba.";
  const serviceIds = [...new Set(booking.serviceIds)];
  if (serviceIds.length !== booking.serviceIds.length) return "La selección de servicios no es válida.";
  const services = serviceIds.map((serviceId) => professional.services?.find((service) => service.id === serviceId));
  if (services.some((service) => !service)) return "Uno de los servicios ya no está disponible.";
  const expectedDuration = services.reduce((sum, service) => sum + Number(service.duration), 0);
  const expectedPrice = services.reduce((sum, service) => sum + Number(service.price), 0);
  if (booking.duration !== expectedDuration || booking.totalPrice !== expectedPrice) return "El precio o la duración cambió. Volvé a elegir el servicio.";

  const schedule = scheduleForDate(professional, booking.date);
  let allowedSlots = professional.availableSlots ?? [];
  let scheduleEnd = null;
  if (schedule) {
    if (schedule.closed) return "El profesional no trabaja en esa fecha.";
    const generated = scheduleSlots(schedule);
    if (!generated) return "El horario del profesional no es válido.";
    allowedSlots = generated.slots;
    scheduleEnd = generated.endMinute;
  }
  if (!allowedSlots.includes(booking.time)) return "Ese horario no está dentro de la disponibilidad del profesional.";
  const [hours, minutes] = booking.time.split(":").map(Number);
  const startMinute = hours * 60 + minutes;
  if (scheduleEnd !== null && startMinute + booking.duration > scheduleEnd) return "El turno excede el horario del profesional.";

  const hasConflict = await hasBookingConflict(db, booking, storeCode, bookingCapacityForDate(professional, booking.date), bookingId);
  return hasConflict ? "Ese horario acaba de ser reservado o completó sus lugares disponibles. Elegí otro horario." : null;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Vary", "Authorization");
  if (request.method !== "GET" && request.method !== "PUT" && request.method !== "POST") {
    response.setHeader("Allow", "GET, PUT, POST");
    return response.status(405).json({ error: "Método no permitido." });
  }

  let user = null;
  if (request.headers.authorization) {
    try {
      user = await verifyUser(request);
    } catch (error) {
      console.error("No se pudo verificar la configuración de Kinde", error);
      return response.status(503).json({ error: error instanceof Error ? error.message : "Kinde no está configurado." });
    }
  }
  if (request.headers.authorization && !user) {
    return response.status(401).json({ error: "La sesión no es válida o no contiene un correo verificado." });
  }
  if (request.method === "PUT" && !user) {
    return response.status(401).json({ error: "Inicia sesión para guardar tus turnos." });
  }

  let db;
  try {
    db = await database();
  } catch (error) {
    console.error("No se pudo conectar con Turso", error);
    return response.status(503).json({ error: error instanceof Error ? error.message : "Turso no está configurado." });
  }

  if (request.method === "GET") {
    try {
      let role = "guest";
      const requestedStoreCode = normalizeStoreCode(request.headers["x-store-code"]);
      let userStoreCode = requestedStoreCode;
      if (user) {
        const storedRoleResult = await db.execute({ sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?", args: [user.id] });
        const existingRole = storedRoleResult.rows[0]?.role;
        role = user.emailVerified && (existingRole === "admin" || existingRole === "client") ? existingRole : "unassigned";
        userStoreCode = role === "admin" ? normalizeStoreCode(storedRoleResult.rows[0]?.store_code) : requestedStoreCode;
      }
      if (userStoreCode) {
        const storeExists = await db.execute({ sql: "SELECT code, subscription_expires_at FROM stores WHERE code = ?", args: [userStoreCode] });
        if (!storeExists.rows[0]) return response.status(404).json({ error: "No encontramos esa sucursal. Revisá el nombre o código." });
        if (role === "admin") await activateFreeTrial(db, userStoreCode);
        if (role !== "admin" && !isSubscriptionActive(storeExists.rows[0].subscription_expires_at)) {
          return response.status(404).json({ error: "Esta sucursal no está disponible para reservas en este momento." });
        }
      }
      const [bookingRows, professionalRows, storesResult] = await Promise.all([
        db.execute("SELECT id, value FROM bookings ORDER BY updated_at DESC"),
        db.execute("SELECT id, value FROM professionals ORDER BY updated_at DESC"),
        db.execute("SELECT code, name, owner_id, settings, subscription_expires_at, subscription_plan_type FROM stores ORDER BY name COLLATE NOCASE"),
      ]);
      const allBookings = bookingRows.rows.map((row) => JSON.parse(String(row.value)));
      const storeBookings = userStoreCode
        ? allBookings.filter((booking) => normalizeStoreCode(booking.storeCode) === userStoreCode)
        : [];
      const bookings = role === "admin"
        ? storeBookings
        : storeBookings.map((booking) => user && booking.customer?.email?.trim().toLowerCase() === user.email
          ? booking
          : {
            id: booking.id,
            barberId: booking.barberId,
            serviceIds: booking.serviceIds,
            date: booking.date,
            time: booking.time,
            duration: booking.duration,
            totalPrice: 0,
            status: booking.status,
            createdAt: booking.createdAt,
            customer: { fullName: "", phone: "", email: "" },
          });
      const professionals = userStoreCode ? professionalRows.rows
        .filter((row) => String(row.id).startsWith(`${userStoreCode}:`))
        .map((row) => ({ ...JSON.parse(String(row.value)), id: String(row.id).slice(userStoreCode.length + 1) })) : [];
      const stores = storesResult.rows
        .filter((row) => String(row.owner_id) !== "legacy")
        .filter((row) => isSubscriptionActive(row.subscription_expires_at) || (role === "admin" && String(row.code) === userStoreCode))
        .map((row) => ({
          code: String(row.code),
          name: String(row.name),
          settings: parseStoreSettings(row.settings),
          subscriptionExpiresAt: row.subscription_expires_at ? String(row.subscription_expires_at) : null,
          subscriptionActive: isSubscriptionActive(row.subscription_expires_at),
          subscriptionPlanType: String(row.subscription_plan_type ?? ""),
        }));
      return response.status(200).json({ data: { bookings, professionals }, role, storeCode: userStoreCode || null, stores });
    } catch (error) {
      console.error("No se pudieron cargar los turnos y profesionales", error);
      return response.status(500).json({ error: "No se pudieron cargar los datos." });
    }
  }

  let body;
  try {
    body = parseBody(request.body);
  } catch {
    return response.status(400).json({ error: "El cuerpo JSON no es válido." });
  }
  if (request.method === "POST") {
    if (body?.action === "cancel-pending-booking") {
      const bookingId = typeof body.bookingId === "string" ? body.bookingId : "";
      const cancellationToken = typeof body.cancellationToken === "string" ? body.cancellationToken : "";
      if (!/^[\da-f-]{36}$/i.test(bookingId) || !/^[\da-f-]{36}$/i.test(cancellationToken)) {
        return response.status(400).json({ error: "La solicitud para cancelar la reserva no es válida." });
      }

      let transaction;
      try {
        transaction = await db.transaction("write");
        const result = await transaction.execute({ sql: "SELECT value FROM bookings WHERE id = ?", args: [bookingId] });
        if (!result.rows[0]) {
          await transaction.rollback();
          return response.status(404).json({ error: "No encontramos la reserva pendiente." });
        }
        const booking = JSON.parse(String(result.rows[0].value));
        const requestedStoreCode = normalizeStoreCode(request.headers["x-store-code"]);
        if (normalizeStoreCode(booking.storeCode) !== requestedStoreCode) {
          await transaction.rollback();
          return response.status(403).json({ error: "La reserva no corresponde a la sucursal seleccionada." });
        }
        if (booking.status !== "pending-payment" || booking.cancellationToken !== cancellationToken) {
          await transaction.rollback();
          return response.status(403).json({ error: "No se puede cancelar esta reserva pendiente." });
        }
        if (user && booking.customer?.email?.trim().toLowerCase() !== user.email) {
          await transaction.rollback();
          return response.status(403).json({ error: "La reserva no pertenece a esta cuenta." });
        }
        booking.status = "cancelled";
        delete booking.cancellationToken;
        await transaction.execute({
          sql: "UPDATE bookings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          args: [JSON.stringify(booking), bookingId],
        });
        await transaction.commit();
        return response.status(200).json({ ok: true });
      } catch (error) {
        if (transaction) await transaction.rollback().catch(() => undefined);
        console.error("No se pudo cancelar la reserva pendiente", error);
        return response.status(500).json({ error: "No se pudo cancelar la reserva pendiente." });
      }
    }
    if (!user && body?.action === "mercadopago-subscription-webhook") {
      try {
        const result = await verifyMercadoPagoPayment(db, String(body.paymentId ?? ""));
        return response.status(200).json({ received: true, approved: result.approved });
      } catch (error) {
        console.error("No se pudo procesar la notificación de suscripción de Mercado Pago", error);
        return response.status(200).json({ received: true });
      }
    }
    if (user && body?.action === "create-subscription-checkout") {
      let orderId;
      try {
        if (!user.emailVerified) return response.status(403).json({ error: "Verificá tu email antes de contratar un plan." });
        const plan = SUBSCRIPTION_PLANS.get(String(body.planId));
        if (!plan) return response.status(400).json({ error: "Elegí uno de los planes disponibles." });
        const promoCode = typeof body.promoCode === "string" ? body.promoCode.trim().toUpperCase() : "";
        const discountPercent = promoCode ? subscriptionPromoDiscountPercent(promoCode) : 0;
        if (promoCode && discountPercent <= 0) return response.status(400).json({ error: "El código promocional no es válido." });
        if (discountPercent >= 100) return response.status(400).json({ error: "Este código activa un plan gratis y no requiere pago." });
        const payableAmount = Math.round(plan.amount * (100 - discountPercent) / 100);
        const roleResult = await db.execute({ sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?", args: [user.id] });
        const storeCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        if (roleResult.rows[0]?.role !== "admin" || !storeCode) return response.status(403).json({ error: "Solo el administrador de una sucursal puede contratar el plan." });
        const storeResult = await db.execute({ sql: "SELECT code FROM stores WHERE code = ?", args: [storeCode] });
        if (!storeResult.rows[0]) return response.status(404).json({ error: "No encontramos tu sucursal." });
        const accessToken = requiredEnv("MERCADOPAGO_ACCESS_TOKEN");
        const host = request.headers.host || "localhost";
        const protocol = request.headers["x-forwarded-proto"] || "https";
        const appUrl = (process.env.PUBLIC_APP_URL || `${protocol}://${host}`).replace(/\/$/, "");
        orderId = randomBytes(18).toString("hex");
        await db.execute({
          sql: "INSERT INTO subscription_orders (id, store_code, owner_id, months, duration_days, amount, status, method) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'mercadopago')",
          args: [orderId, storeCode, user.id, plan.months, plan.days, payableAmount],
        });
        const preferenceResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [{ id: `subscription-${String(body.planId)}`, title: `Plan de turnos por ${plan.label}${discountPercent ? ` (${discountPercent}% de descuento)` : ""}`, quantity: 1, currency_id: "ARS", unit_price: payableAmount }],
            payer: { email: user.email },
            external_reference: orderId,
            notification_url: `${appUrl}/api/mercadopago/webhook`,
            back_urls: {
              success: `${appUrl}/plan?subscription_payment=success&purchase_id=${orderId}`,
              failure: `${appUrl}/plan?subscription_payment=failure&purchase_id=${orderId}`,
              pending: `${appUrl}/plan?subscription_payment=pending&purchase_id=${orderId}`,
            },
            auto_return: "approved",
          }),
        });
        const preference = await preferenceResponse.json();
        if (!preferenceResponse.ok || !preference.init_point) {
          await db.execute({ sql: "UPDATE subscription_orders SET status = 'failed' WHERE id = ? AND status = 'pending'", args: [orderId] });
          console.error("Mercado Pago subscription preference failed", preferenceResponse.status);
          return response.status(502).json({ error: "Mercado Pago no pudo preparar el pago. Revisá la configuración del token." });
        }
        return response.status(200).json({ checkoutUrl: preference.init_point, purchaseId: orderId });
      } catch (error) {
        if (orderId) await db.execute({ sql: "UPDATE subscription_orders SET status = 'failed' WHERE id = ? AND status = 'pending'", args: [orderId] }).catch(() => undefined);
        console.error("No se pudo iniciar el pago del plan", error);
        return response.status(500).json({ error: error instanceof Error ? error.message : "No se pudo iniciar el pago del plan." });
      }
    }
    if (user && body?.action === "redeem-subscription-promo") {
      try {
        if (!user.emailVerified) return response.status(403).json({ error: "Verificá tu email antes de activar el plan." });
        const submittedCode = typeof body.code === "string" ? body.code.trim() : "";
        const normalizedCode = submittedCode.toUpperCase();
        const discountPercent = submittedCode ? subscriptionPromoDiscountPercent(normalizedCode) : 0;
        if (!discountPercent) {
          return response.status(400).json({ error: "El código promocional no es válido." });
        }
        const plan = SUBSCRIPTION_PLANS.get(String(body.planId));
        if (!plan) return response.status(400).json({ error: "Elegí uno de los planes disponibles." });
        const roleResult = await db.execute({ sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?", args: [user.id] });
        const storeCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        if (roleResult.rows[0]?.role !== "admin" || !storeCode) return response.status(403).json({ error: "Solo el administrador de una sucursal puede aplicar el código." });
        if (discountPercent === 10) {
          return response.status(200).json({ discountPercent, planLabel: plan.label });
        }
        if (discountPercent !== 100) return response.status(400).json({ error: "El código promocional no es válido." });
        const transaction = await db.transaction("write");
        try {
          const store = await transaction.execute({ sql: "SELECT subscription_expires_at FROM stores WHERE code = ?", args: [storeCode] });
          if (!store.rows[0]) throw new Error("No encontramos tu sucursal.");
          const currentExpiry = String(store.rows[0].subscription_expires_at ?? "");
          const startDate = currentExpiry && Date.parse(currentExpiry) > Date.now() ? currentExpiry : new Date().toISOString();
          const expiresAt = plan.days > 0
            ? addSubscriptionDays(startDate, plan.days)
            : addSubscriptionMonths(startDate, plan.months);
          const orderId = randomBytes(18).toString("hex");
          await transaction.execute({
            sql: "INSERT INTO subscription_orders (id, store_code, owner_id, months, duration_days, amount, status, method, paid_at) VALUES (?, ?, ?, ?, ?, 0, 'paid', 'promo', CURRENT_TIMESTAMP)",
            args: [orderId, storeCode, user.id, plan.months, plan.days],
          });
          await transaction.execute({ sql: "UPDATE stores SET subscription_expires_at = ?, subscription_plan_type = 'promo' WHERE code = ?", args: [expiresAt, storeCode] });
          await transaction.commit();
          return response.status(200).json({ expiresAt, planLabel: plan.label, discountPercent });
        } catch (error) {
          await transaction.rollback().catch(() => undefined);
          throw error;
        }
      } catch (error) {
        console.error("No se pudo canjear el código promocional", error);
        return response.status(500).json({ error: error instanceof Error ? error.message : "No se pudo activar el plan promocional." });
      }
    }
    if (user && body?.action === "verify-subscription-payment") {
      try {
        if (!user.emailVerified) return response.status(403).json({ error: "Verificá tu email antes de comprobar el pago." });
        const result = body.purchaseId
          ? await verifySubscriptionPurchase(db, String(body.purchaseId), user.id)
          : await verifyMercadoPagoPayment(db, String(body.paymentId ?? ""), user.id);
        return response.status(200).json(result);
      } catch (error) {
        console.error("No se pudo verificar el pago del plan", error);
        return response.status(400).json({ error: error instanceof Error ? error.message : "No se pudo verificar el pago." });
      }
    }
    if (user && body?.action === "set-account-role") {
      try {
        if (!user.emailVerified) return response.status(403).json({ error: "Verificá tu email en Kinde antes de configurar el acceso." });
        const requestedRole = body.role === "admin" ? "admin" : body.role === "client" ? "client" : null;
        if (!requestedRole) return response.status(400).json({ error: "Tipo de cuenta inválido." });
        const transaction = await db.transaction("write");
        try {
          const existingAccount = await transaction.execute({
            sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
            args: [user.id],
          });
          const existingStoreCode = normalizeStoreCode(existingAccount.rows[0]?.store_code);
          if (requestedRole === "admin" && existingAccount.rows[0]?.role === "admin" && existingStoreCode) {
            await transaction.commit();
            return response.status(200).json({ role: requestedRole, storeCode: existingStoreCode });
          }

          if (requestedRole === "client") {
            await transaction.execute({
              sql: `INSERT INTO account_roles (user_id, email, role, store_code, updated_at) VALUES (?, ?, 'client', NULL, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, role = 'client', store_code = NULL, updated_at = CURRENT_TIMESTAMP`,
              args: [user.id, user.email],
            });
            await transaction.commit();
            return response.status(200).json({ role: requestedRole, storeCode: null });
          }

          await transaction.execute({
            sql: `INSERT INTO account_roles (user_id, email, role, store_code, updated_at) VALUES (?, ?, 'admin', ?, CURRENT_TIMESTAMP)
              ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, role = 'admin', store_code = excluded.store_code, updated_at = CURRENT_TIMESTAMP`,
            args: [user.id, user.email, null],
          });
          await transaction.commit();
          return response.status(200).json({ role: requestedRole, storeCode: null });
        } catch (error) {
          await transaction.rollback().catch(() => undefined);
          throw error;
        }
      } catch (error) {
        console.error("No se pudo guardar el rol de cuenta", error);
        return response.status(500).json({ error: "No se pudo guardar la cuenta." });
      }
    }
    if (user && body?.action === "create-store") {
      let transaction;
      try {
        if (!user.emailVerified) return response.status(403).json({ error: "Solo una cuenta administradora verificada puede guardar una sucursal." });
        const code = normalizeStoreCode(body.store?.code);
        const name = typeof body.store?.name === "string" ? body.store.name.trim() : "";
        if (!/^[A-Z0-9][A-Z0-9_-]{2,19}$/.test(code) || name.length < 2 || name.length > 100) {
          return response.status(400).json({ error: "El nombre debe tener de 2 a 100 caracteres y el código de 3 a 20 letras o números." });
        }

        transaction = await db.transaction("write");
        const roleResult = await transaction.execute({ sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?", args: [user.id] });
        if (roleResult.rows[0]?.role !== "admin") {
          await transaction.rollback();
          return response.status(403).json({ error: "Solo una cuenta administradora verificada puede guardar una sucursal." });
        }

        const assignedCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        let existingStore = assignedCode
          ? await transaction.execute({
            sql: "SELECT code, settings, subscription_expires_at, subscription_plan_type FROM stores WHERE code = ? AND owner_id = ?",
            args: [assignedCode, user.id],
          })
          : { rows: [] };
        if (!existingStore.rows[0]) {
          existingStore = await transaction.execute({
            sql: "SELECT code, settings, subscription_expires_at, subscription_plan_type FROM stores WHERE owner_id = ? ORDER BY created_at LIMIT 1",
            args: [user.id],
          });
        }
        const currentStore = existingStore.rows[0];
        const previousCode = currentStore ? normalizeStoreCode(currentStore.code) : "";

        if (!currentStore) {
          await transaction.execute({ sql: "INSERT INTO stores (code, name, owner_id) VALUES (?, ?, ?)", args: [code, name, user.id] });
        } else {
          if (previousCode !== code) {
            const professionalPrefix = `${previousCode}:`;
            const professionalRows = await transaction.execute({
              sql: "SELECT id, value FROM professionals WHERE substr(id, 1, ?) = ?",
              args: [professionalPrefix.length, professionalPrefix],
            });
            for (const row of professionalRows.rows) {
              const oldId = String(row.id);
              const professional = JSON.parse(String(row.value));
              professional.storeCode = code;
              await transaction.execute({
                sql: "UPDATE professionals SET id = ?, value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                args: [`${code}:${oldId.slice(professionalPrefix.length)}`, JSON.stringify(professional), oldId],
              });
            }

            const bookingRows = await transaction.execute({ sql: "SELECT id, value FROM bookings" });
            for (const row of bookingRows.rows) {
              const booking = JSON.parse(String(row.value));
              if (normalizeStoreCode(booking.storeCode) !== previousCode) continue;
              booking.storeCode = code;
              await transaction.execute({ sql: "UPDATE bookings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", args: [JSON.stringify(booking), String(row.id)] });
            }
            await transaction.execute({ sql: "UPDATE subscription_orders SET store_code = ? WHERE store_code = ?", args: [code, previousCode] });
          }
          await transaction.execute({ sql: "UPDATE stores SET code = ?, name = ? WHERE code = ? AND owner_id = ?", args: [code, name, previousCode, user.id] });
        }
        await transaction.execute({ sql: "UPDATE account_roles SET store_code = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", args: [code, user.id] });
        await transaction.commit();
        return response.status(currentStore ? 200 : 201).json({
          ok: true,
          previousCode,
          store: {
            code,
            name,
            settings: currentStore ? parseStoreSettings(currentStore.settings) : parseStoreSettings("{}"),
            subscriptionExpiresAt: currentStore?.subscription_expires_at ? String(currentStore.subscription_expires_at) : null,
            subscriptionActive: isSubscriptionActive(currentStore?.subscription_expires_at),
            subscriptionPlanType: String(currentStore?.subscription_plan_type ?? ""),
          },
        });
      } catch (error) {
        if (transaction) await transaction.rollback().catch(() => undefined);
        if (String(error?.message || "").toLowerCase().includes("unique")) return response.status(409).json({ error: "Ese código ya está utilizado. Elegí otro." });
        console.error("No se pudo guardar la sucursal", error);
        return response.status(500).json({ error: "No se pudo guardar la sucursal." });
      }
    }
    if (user && body?.action === "update-store-settings") {
      try {
        const roleResult = await db.execute({ sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?", args: [user.id] });
        const role = roleResult.rows[0]?.role;
        const storeCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        const settings = validateStoreSettings(body.settings);
        if (role !== "admin" || !user.emailVerified || !storeCode) return response.status(403).json({ error: "Solo el administrador de una sucursal puede modificar sus datos." });
        if (!settings) return response.status(400).json({ error: "Revisá los datos de contacto y transferencia bancaria." });
        if (!settings.transferHolder.trim()) return response.status(400).json({ error: "El titular de la cuenta es obligatorio." });
        if (!settings.transferCbu.trim() && !settings.transferAlias.trim()) return response.status(400).json({ error: "Completá el CBU o el alias para recibir transferencias bancarias." });
        await db.execute({ sql: "UPDATE stores SET settings = ? WHERE code = ?", args: [JSON.stringify(settings), storeCode] });
        return response.status(200).json({ code: storeCode, settings });
      } catch (error) {
        console.error("No se pudieron guardar los datos de la sucursal", error);
        return response.status(500).json({ error: "No se pudieron guardar los datos de la sucursal." });
      }
    }
    if (user && body?.action === "update-store-contact") {
      try {
        const roleResult = await db.execute({ sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?", args: [user.id] });
        const role = roleResult.rows[0]?.role;
        const storeCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        if (role !== "admin" || !user.emailVerified || !storeCode) return response.status(403).json({ error: "Solo el administrador de una sucursal puede modificar sus datos de contacto." });
        const storeResult = await db.execute({ sql: "SELECT settings FROM stores WHERE code = ?", args: [storeCode] });
        if (!storeResult.rows[0]) return response.status(404).json({ error: "No encontramos la sucursal." });
        const currentSettings = parseStoreSettings(storeResult.rows[0].settings);
        const contact = body.contact && typeof body.contact === "object" && !Array.isArray(body.contact) ? body.contact : {};
        const settings = validateStoreSettings({
          ...currentSettings,
          street: contact.street ?? currentSettings.street,
          height: contact.height ?? currentSettings.height,
          city: contact.city ?? currentSettings.city,
          province: contact.province ?? currentSettings.province,
          postalCode: contact.postalCode ?? currentSettings.postalCode,
          whatsapp: contact.whatsapp ?? currentSettings.whatsapp,
          instagram: contact.instagram ?? currentSettings.instagram,
        });
        if (!settings) return response.status(400).json({ error: "Revisá los datos de contacto ingresados." });
        await db.execute({ sql: "UPDATE stores SET settings = ? WHERE code = ?", args: [JSON.stringify(settings), storeCode] });
        return response.status(200).json({ code: storeCode, settings });
      } catch (error) {
        console.error("No se pudieron guardar los datos de contacto", error);
        return response.status(500).json({ error: "No se pudieron guardar los datos de contacto." });
      }
    }
    if (user || body?.action !== "guest-booking") {
      return response.status(400).json({ error: "Acción pública inválida." });
    }
    const booking = body.booking;
    const customer = booking?.customer;
    const id = recordId(booking);
    const validEmail = typeof customer?.email === "string" && /^.+@.+\..+$/.test(customer.email.trim());
    const parsedDate = typeof booking?.date === "string" ? new Date(`${booking.date}T12:00:00Z`) : null;
    const todayInArgentina = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
    const validBooking = id && id.length >= 20
      && typeof customer?.fullName === "string" && customer.fullName.trim().length > 0 && customer.fullName.length <= 160
      && typeof customer.phone === "string" && customer.phone.trim().length >= 6 && customer.phone.length <= 40
      && validEmail
      && typeof booking.barberId === "string" && booking.barberId.length <= 200
      && Array.isArray(booking.serviceIds) && booking.serviceIds.length > 0 && booking.serviceIds.length <= 20
      && typeof booking.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(booking.date)
      && parsedDate && !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === booking.date && booking.date >= todayInArgentina
      && typeof booking.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(booking.time)
      && Number.isFinite(booking.duration) && booking.duration > 0 && booking.duration <= 1440
      && Number.isFinite(booking.totalPrice) && booking.totalPrice >= 0 && booking.totalPrice <= 100000000
      && ["pending-payment", "confirmed"].includes(booking.status);
    if (!validBooking) return response.status(400).json({ error: "Los datos de la reserva no son válidos." });
    let transaction;
    try {
      const storeCode = normalizeStoreCode(request.headers["x-store-code"]);
      if (!storeCode) return response.status(400).json({ error: "Seleccioná una sucursal para reservar." });
      const storeResult = await db.execute({ sql: "SELECT code, subscription_expires_at FROM stores WHERE code = ?", args: [storeCode] });
      if (!storeResult.rows[0]) return response.status(404).json({ error: "No encontramos la sucursal seleccionada." });
      if (!isSubscriptionActive(storeResult.rows[0].subscription_expires_at)) return response.status(403).json({ error: "Esta sucursal no tiene un plan activo para aceptar reservas." });
      booking.storeCode = storeCode;
      const professionalResult = await db.execute({ sql: "SELECT value FROM professionals WHERE id = ?", args: [storedRecordId(storeCode, booking.barberId)] });
      if (!professionalResult.rows[0]) return response.status(400).json({ error: "El profesional elegido ya no está disponible." });
      const professional = JSON.parse(String(professionalResult.rows[0].value));
      if (professional.isTest) return response.status(400).json({ error: "No se pueden reservar turnos de prueba." });
      const serviceIds = [...new Set(booking.serviceIds)];
      if (serviceIds.length !== booking.serviceIds.length) return response.status(400).json({ error: "La selección de servicios no es válida." });
      const services = serviceIds.map((serviceId) => professional.services?.find((service) => service.id === serviceId));
      if (services.some((service) => !service)) return response.status(400).json({ error: "Uno de los servicios ya no está disponible." });
      const expectedDuration = services.reduce((sum, service) => sum + Number(service.duration), 0);
      const expectedPrice = services.reduce((sum, service) => sum + Number(service.price), 0);
      if (booking.duration !== expectedDuration || booking.totalPrice !== expectedPrice) {
        return response.status(400).json({ error: "El precio o la duración del turno ya cambió. Volvé a seleccionar el servicio." });
      }

      const schedule = scheduleForDate(professional, booking.date);
      let allowedSlots = professional.availableSlots ?? [];
      let scheduleEnd = null;
      if (schedule) {
        if (schedule.closed) return response.status(400).json({ error: "El profesional no trabaja en esa fecha." });
        const generated = scheduleSlots(schedule);
        if (!generated) return response.status(400).json({ error: "El horario del profesional no es válido." });
        allowedSlots = generated.slots;
        scheduleEnd = generated.endMinute;
      }
      if (!allowedSlots.includes(booking.time)) return response.status(400).json({ error: "Ese horario no está dentro de la disponibilidad del profesional." });
      const [hours, minutes] = booking.time.split(":").map(Number);
      const startMinute = hours * 60 + minutes;
      if (scheduleEnd !== null && startMinute + booking.duration > scheduleEnd) {
        return response.status(400).json({ error: "El turno excede el horario de atención del profesional." });
      }

      transaction = await db.transaction("write");
      const hasConflict = await hasBookingConflict(transaction, booking, storeCode, bookingCapacityForDate(professional, booking.date));
      if (hasConflict) {
        await transaction.rollback();
        return response.status(409).json({ error: "Ese horario acaba de ser reservado o completó sus lugares disponibles. Elegí otro horario." });
      }

      await transaction.execute({
        sql: "INSERT INTO bookings (id, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO NOTHING",
        args: [id, JSON.stringify(booking)],
      });
      await transaction.commit();
      return response.status(201).json({ ok: true });
    } catch (error) {
      if (transaction) await transaction.rollback().catch(() => undefined);
      console.error("No se pudo guardar la reserva pública", error);
      return response.status(500).json({ error: "No se pudo guardar la reserva." });
    }
  }

  if (!body || !COLLECTIONS.includes(body.collection)) {
    return response.status(400).json({ error: "Colección inválida." });
  }

  const records = body.records;
  const deleteIds = Array.isArray(body.deleteIds)
    ? body.deleteIds.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 200).slice(0, 100)
    : [];
  if (!Array.isArray(records) || records.length > 100 || JSON.stringify(body).length > 4_000_000) {
    return response.status(413).json({ error: "La sincronización supera el tamaño permitido." });
  }
  let role = "client";
  let storeCode = normalizeStoreCode(request.headers["x-store-code"]);
  try {
    if (user) {
      const accountRole = await db.execute({ sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?", args: [user.id] });
      if (!accountRole.rows[0] || !["admin", "client"].includes(String(accountRole.rows[0].role))) {
        return response.status(403).json({ error: "Configurá tu tipo de cuenta antes de guardar datos." });
      }
      role = accountRole.rows[0].role;
      if (role === "admin" && user.emailVerified) storeCode = normalizeStoreCode(accountRole.rows[0]?.store_code);
    }
    if (!storeCode) return response.status(400).json({ error: "Seleccioná una sucursal antes de guardar." });
  } catch (error) {
    console.error("No se pudo verificar el rol de la cuenta", error);
    return response.status(500).json({ error: "No se pudo verificar el rol de la cuenta." });
  }

  if (body.collection === "professionals" && deleteIds.length > 0 && role !== "admin") {
    return response.status(403).json({ error: "Solo un administrador puede eliminar profesionales." });
  }

  if (body.collection === "professionals" && role !== "admin") {
    return response.status(403).json({ error: "Solo las cuentas administradoras pueden modificar profesionales." });
  }

  try {
    const statements = [];
    for (const record of records) {
      const id = recordId(record);
      if (!id) return response.status(400).json({ error: "Hay un registro con identificador inválido." });
      record.storeCode = storeCode;
      const databaseId = body.collection === "professionals" ? storedRecordId(storeCode, id) : id;
      const storedRecord = await db.execute({ sql: `SELECT value FROM ${body.collection} WHERE id = ?`, args: [databaseId] });
      if (storedRecord.rows[0]) {
        const priorRecord = JSON.parse(String(storedRecord.rows[0].value));
        if (normalizeStoreCode(priorRecord.storeCode) !== storeCode) {
          return response.status(403).json({ error: "El registro no pertenece a la sucursal seleccionada." });
        }
      }
      if (body.collection === "bookings" && role !== "admin") {
        if (normalizeStoreCode(record.storeCode) !== storeCode) return response.status(403).json({ error: "La reserva no corresponde a la sucursal seleccionada." });
        if (typeof record.customer?.email !== "string" || record.customer.email.trim().toLowerCase() !== user.email) {
          return response.status(403).json({ error: "Solo puedes guardar turnos asociados a tu propio correo." });
        }
        const existing = await db.execute({ sql: "SELECT value FROM bookings WHERE id = ?", args: [databaseId] });
        if (existing.rows[0]) {
          const prior = JSON.parse(String(existing.rows[0].value));
          if (prior.customer?.email?.trim().toLowerCase() !== user.email) {
            return response.status(403).json({ error: "No puedes modificar un turno de otra persona." });
          }
          const immutableFields = ["id", "customer", "barberId", "serviceIds", "date", "time", "duration", "totalPrice", "status", "createdAt", "isTest"];
          if (immutableFields.some((field) => JSON.stringify(prior[field]) !== JSON.stringify(record[field]))) {
            return response.status(403).json({ error: "Solo puedes confirmar tu turno; los datos de la reserva no se pueden modificar desde la cuenta cliente." });
          }
          if (record.appointmentConfirmation !== "confirmed" && record.appointmentConfirmation !== "pending") {
            return response.status(400).json({ error: "El estado de confirmación no es válido." });
          }
        } else {
          if (!record.customer?.fullName || typeof record.customer.fullName !== "string"
            || typeof record.customer.phone !== "string" || record.customer.phone.trim().length < 6
            || typeof record.customer.email !== "string" || !/^.+@.+\..+$/.test(record.customer.email)
            || !Array.isArray(record.serviceIds) || record.serviceIds.length === 0
            || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(record.time)
            || !Number.isFinite(record.duration) || record.duration <= 0
            || !Number.isFinite(record.totalPrice) || record.totalPrice < 0
            || !["confirmed", "pending-payment"].includes(record.status)) {
            return response.status(400).json({ error: "Los datos del turno no son válidos." });
          }
          const availabilityError = await validateBookingAvailability(db, record, storeCode, id);
          if (availabilityError) {
            const conflict = availabilityError.includes("acaba de ser reservado");
            return response.status(conflict ? 409 : 400).json({ error: availabilityError });
          }
          const transaction = await db.transaction("write");
          try {
            const capacityProfessional = await transaction.execute({ sql: "SELECT value FROM professionals WHERE id = ?", args: [storedRecordId(storeCode, record.barberId)] });
            if (!capacityProfessional.rows[0]) {
              await transaction.rollback();
              return response.status(400).json({ error: "El profesional elegido ya no está disponible." });
            }
            const professionalForCapacity = JSON.parse(String(capacityProfessional.rows[0].value));
            if (await hasBookingConflict(transaction, record, storeCode, bookingCapacityForDate(professionalForCapacity, record.date), id)) {
              await transaction.rollback();
              return response.status(409).json({ error: "Ese horario acaba de ser reservado o completó sus lugares disponibles. Elegí otro horario." });
            }
            await transaction.execute({
              sql: "INSERT INTO bookings (id, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO NOTHING",
              args: [databaseId, JSON.stringify(record)],
            });
            await transaction.commit();
          } catch (error) {
            await transaction.rollback().catch(() => undefined);
            throw error;
          }
          continue;
        }
      }
      statements.push({
        sql: `INSERT INTO ${body.collection} (id, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        args: [databaseId, JSON.stringify(record)],
      });
    }
    for (const id of deleteIds) {
      if (role !== "admin") {
        return response.status(403).json({ error: "Solo un administrador puede eliminar turnos." });
      }
      const databaseId = body.collection === "professionals" ? storedRecordId(storeCode, id) : id;
      const existing = await db.execute({ sql: `SELECT value FROM ${body.collection} WHERE id = ?`, args: [databaseId] });
      if (!existing.rows[0]) continue;
      if (normalizeStoreCode(JSON.parse(String(existing.rows[0].value)).storeCode) !== storeCode) {
        return response.status(403).json({ error: "El registro no pertenece a esta sucursal." });
      }
      statements.push({ sql: `DELETE FROM ${body.collection} WHERE id = ?`, args: [databaseId] });
    }
    if (statements.length) await db.batch(statements, "write");
    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error("No se pudieron guardar datos en Turso", error);
    return response.status(500).json({ error: "No se pudieron guardar los datos." });
  }
}
