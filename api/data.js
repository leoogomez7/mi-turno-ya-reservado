import { createClient } from "@libsql/client";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const COLLECTIONS = ["bookings", "professionals"];
const DEFAULT_STORE_CODE = "GENERAL";
let schemaReady;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta configurar ${name} en el servidor.`);
  return value;
}

function isValidAdminInvite(candidate) {
  const configured = process.env.ADMIN_INVITE_CODE?.trim();
  if (!configured || typeof candidate !== "string" || !candidate.trim()) return false;
  const expectedBuffer = Buffer.from(configured);
  const candidateBuffer = Buffer.from(candidate.trim());
  return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer);
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

function parseStoreSettings(value) {
  try {
    const settings = JSON.parse(String(value || "{}"));
    const source = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
    return {
      address: typeof source.address === "string" ? source.address : "",
      whatsapp: typeof source.whatsapp === "string" ? source.whatsapp : "",
      transferHolder: typeof source.transferHolder === "string" ? source.transferHolder : "",
      transferBank: typeof source.transferBank === "string" ? source.transferBank : "",
      transferCbu: typeof source.transferCbu === "string" ? source.transferCbu : "",
      transferAlias: typeof source.transferAlias === "string" ? source.transferAlias : "",
    };
  } catch {
    return { address: "", whatsapp: "", transferHolder: "", transferBank: "", transferCbu: "", transferAlias: "" };
  }
}

function validateStoreSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields = ["address", "whatsapp", "transferHolder", "transferBank", "transferCbu", "transferAlias"];
  const settings = {};
  for (const field of fields) {
    const setting = value[field] ?? "";
    if (typeof setting !== "string" || setting.length > 200) return null;
    settings[field] = setting.trim();
  }
  if (settings.whatsapp && !/^\+?[0-9 ()-]{8,25}$/.test(settings.whatsapp)) return null;
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
    `CREATE TABLE IF NOT EXISTS admin_invites (
      code_hash TEXT PRIMARY KEY,
      store_code TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    "CREATE INDEX IF NOT EXISTS bookings_updated ON bookings(updated_at)",
    "CREATE INDEX IF NOT EXISTS professionals_updated ON professionals(updated_at)",
  ]).then(() => undefined).catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  await schemaReady;
  await ensureRoleStoreColumn(db);
  await ensureStoreSettingsColumn(db);
  await db.execute({
    sql: "INSERT INTO stores (code, name, owner_id) VALUES (?, ?, ?) ON CONFLICT(code) DO NOTHING",
    args: [DEFAULT_STORE_CODE, "Mi Turno Ya", "legacy"],
  });
  const legacyProfessionals = await db.execute("SELECT id, value FROM professionals WHERE instr(id, ':') = 0");
  for (const row of legacyProfessionals.rows) {
    const value = JSON.parse(String(row.value));
    value.storeCode = DEFAULT_STORE_CODE;
    await db.execute({
      sql: "INSERT INTO professionals (id, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO NOTHING",
      args: [storedRecordId(DEFAULT_STORE_CODE, String(row.id)), JSON.stringify(value)],
    });
    await db.execute({ sql: "DELETE FROM professionals WHERE id = ?", args: [String(row.id)] });
  }
  const legacyBookings = await db.execute("SELECT id, value FROM bookings");
  for (const row of legacyBookings.rows) {
    const value = JSON.parse(String(row.value));
    if (value.storeCode) continue;
    value.storeCode = DEFAULT_STORE_CODE;
    await db.execute({
      sql: "UPDATE bookings SET value = ? WHERE id = ?",
      args: [JSON.stringify(value), String(row.id)],
    });
  }
  return db;
}

function parseBody(body) {
  if (typeof body === "string") return JSON.parse(body);
  return body;
}

function recordId(record) {
  return record && typeof record === "object" && !Array.isArray(record)
    && typeof record.id === "string" && record.id.length > 0 && record.id.length <= 200
    ? record.id : null;
}

async function validateBookingAvailability(db, booking, storeCode, bookingId = "") {
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

  const schedule = professional.scheduleDates?.find((entry) => entry.date === booking.date);
  let allowedSlots = professional.availableSlots ?? [];
  let scheduleEnd = null;
  if (schedule) {
    const start = /^([0-2]\d):([0-5]\d)$/.exec(schedule.start);
    const end = /^([0-2]\d):([0-5]\d)$/.exec(schedule.end);
    if (!start || !end) return "El horario del profesional no es válido.";
    const firstMinute = Number(start[1]) * 60 + Number(start[2]);
    scheduleEnd = Number(end[1]) * 60 + Number(end[2]);
    allowedSlots = [];
    for (let minute = firstMinute; minute + 30 <= scheduleEnd; minute += 30) {
      allowedSlots.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
    }
  }
  if (!allowedSlots.includes(booking.time)) return "Ese horario no está dentro de la disponibilidad del profesional.";
  const [hours, minutes] = booking.time.split(":").map(Number);
  const startMinute = hours * 60 + minutes;
  if (scheduleEnd !== null && startMinute + booking.duration > scheduleEnd) return "El turno excede el horario del profesional.";

  const existingResult = await db.execute("SELECT id, value FROM bookings");
  const hasConflict = existingResult.rows.some((row) => {
    const existing = JSON.parse(String(row.value));
    const existingStoreCode = normalizeStoreCode(existing.storeCode || DEFAULT_STORE_CODE);
    if (existingStoreCode !== storeCode || existing.id === bookingId) return false;
    if (existing.barberId !== booking.barberId || existing.date !== booking.date || existing.status === "cancelled") return false;
    const [existingHours, existingMinutes] = String(existing.time).split(":").map(Number);
    const existingStart = existingHours * 60 + existingMinutes;
    return startMinute < existingStart + Number(existing.duration) && existingStart < startMinute + booking.duration;
  });
  return hasConflict ? "Ese horario acaba de ser reservado. Elegí otro horario." : null;
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
        const storeExists = await db.execute({ sql: "SELECT code FROM stores WHERE code = ?", args: [userStoreCode] });
        if (!storeExists.rows[0]) return response.status(404).json({ error: "No encontramos esa tienda. Revisá el nombre o código." });
      }
      const [bookingRows, professionalRows] = await Promise.all([
        db.execute("SELECT id, value FROM bookings ORDER BY updated_at DESC"),
        db.execute("SELECT id, value FROM professionals ORDER BY updated_at DESC"),
      ]);
      const allBookings = bookingRows.rows.map((row) => JSON.parse(String(row.value)));
      const storeBookings = userStoreCode
        ? allBookings.filter((booking) => normalizeStoreCode(booking.storeCode || DEFAULT_STORE_CODE) === userStoreCode)
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
      const storesResult = await db.execute("SELECT code, name, settings FROM stores ORDER BY name COLLATE NOCASE");
      return response.status(200).json({ data: { bookings, professionals }, role, storeCode: userStoreCode || null, stores: storesResult.rows.map((row) => ({ code: String(row.code), name: String(row.name), settings: parseStoreSettings(row.settings) })) });
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
    if (user && body?.action === "set-account-role") {
      try {
        if (!user.emailVerified) return response.status(403).json({ error: "Verificá tu email en Kinde antes de configurar el acceso." });
        const requestedRole = body.role === "admin" ? "admin" : body.role === "client" ? "client" : null;
        if (!requestedRole) return response.status(400).json({ error: "Tipo de cuenta inválido." });

        let storeCode = null;
        if (requestedRole === "admin") {
          storeCode = normalizeStoreCode(body.storeCode);
          const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";
          if (!storeCode || !inviteCode) return response.status(400).json({ error: "Ingresá el código de tienda y la invitación de administrador." });
          const inviteHash = createHash("sha256").update(inviteCode).digest("hex");
          const invite = await db.execute({ sql: "SELECT store_code FROM admin_invites WHERE code_hash = ?", args: [inviteHash] });
          const invitedStore = normalizeStoreCode(invite.rows[0]?.store_code);
          const bootstrapStore = await db.execute({ sql: "SELECT owner_id FROM stores WHERE code = ?", args: [DEFAULT_STORE_CODE] });
          const bootstrapAllowed = storeCode === DEFAULT_STORE_CODE
            && String(bootstrapStore.rows[0]?.owner_id) === "legacy"
            && isValidAdminInvite(inviteCode);
          if (invitedStore !== storeCode && !bootstrapAllowed) {
            return response.status(403).json({ error: "La invitación no es válida para esa tienda." });
          }
          const storeExists = await db.execute({ sql: "SELECT code FROM stores WHERE code = ?", args: [storeCode] });
          if (!storeExists.rows[0]) return response.status(404).json({ error: "La tienda no existe." });
        }
        await db.execute({
          sql: `INSERT INTO account_roles (user_id, email, role, store_code, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, role = excluded.role, store_code = excluded.store_code, updated_at = CURRENT_TIMESTAMP`,
          args: [user.id, user.email, requestedRole, storeCode],
        });
        if (requestedRole === "admin" && storeCode === DEFAULT_STORE_CODE) {
          await db.execute({ sql: "UPDATE stores SET owner_id = ? WHERE code = ? AND owner_id = 'legacy'", args: [user.id, DEFAULT_STORE_CODE] });
        }
        return response.status(200).json({ role: requestedRole, storeCode });
      } catch (error) {
        console.error("No se pudo guardar el rol de cuenta", error);
        return response.status(500).json({ error: "No se pudo guardar la cuenta en la base de datos." });
      }
    }
    if (user && body?.action === "create-store") {
      try {
        const roleResult = await db.execute({ sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?", args: [user.id] });
        if (roleResult.rows[0]?.role !== "admin" || !user.emailVerified) return response.status(403).json({ error: "Solo una cuenta administradora verificada puede crear una tienda." });
        const code = normalizeStoreCode(body.store?.code);
        const name = typeof body.store?.name === "string" ? body.store.name.trim() : "";
        if (!/^[A-Z0-9][A-Z0-9_-]{2,19}$/.test(code) || name.length < 2 || name.length > 100) {
          return response.status(400).json({ error: "El nombre debe tener de 2 a 100 caracteres y el código de 3 a 20 letras o números." });
        }
        await db.execute({ sql: "INSERT INTO stores (code, name, owner_id) VALUES (?, ?, ?)", args: [code, name, user.id] });
        await db.execute({ sql: "UPDATE account_roles SET store_code = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", args: [code, user.id] });
        return response.status(201).json({ ok: true, store: { code, name, settings: {} } });
      } catch (error) {
        if (String(error?.message || "").toLowerCase().includes("unique")) return response.status(409).json({ error: "Ese código ya está utilizado. Elegí otro." });
        console.error("No se pudo crear la tienda", error);
        return response.status(500).json({ error: "No se pudo crear la tienda." });
      }
    }
    if (user && body?.action === "update-store-settings") {
      try {
        const roleResult = await db.execute({ sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?", args: [user.id] });
        const role = roleResult.rows[0]?.role;
        const storeCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        const settings = validateStoreSettings(body.settings);
        if (role !== "admin" || !user.emailVerified || !storeCode) return response.status(403).json({ error: "Solo el administrador de una tienda puede modificar sus datos." });
        if (!settings) return response.status(400).json({ error: "Revisá los datos de contacto y transferencia." });
        await db.execute({ sql: "UPDATE stores SET settings = ? WHERE code = ?", args: [JSON.stringify(settings), storeCode] });
        return response.status(200).json({ code: storeCode, settings });
      } catch (error) {
        console.error("No se pudieron guardar los datos de la tienda", error);
        return response.status(500).json({ error: "No se pudieron guardar los datos de la tienda." });
      }
    }
    if (user && body?.action === "create-store-invite") {
      try {
        const roleResult = await db.execute({ sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?", args: [user.id] });
        const role = roleResult.rows[0]?.role;
        const storeCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        if (role !== "admin" || !user.emailVerified || !storeCode) return response.status(403).json({ error: "Solo el administrador de una tienda puede invitar administradores." });
        const code = `ADM-${randomBytes(18).toString("base64url")}`;
        const codeHash = createHash("sha256").update(code).digest("hex");
        await db.execute({
          sql: "INSERT INTO admin_invites (code_hash, store_code, created_by) VALUES (?, ?, ?)",
          args: [codeHash, storeCode, user.id],
        });
        return response.status(201).json({ code, storeCode });
      } catch (error) {
        console.error("No se pudo crear la invitación de administrador", error);
        return response.status(500).json({ error: "No se pudo crear el código de invitación." });
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
      const storeCode = normalizeStoreCode(request.headers["x-store-code"]) || DEFAULT_STORE_CODE;
      const storeResult = await db.execute({ sql: "SELECT code FROM stores WHERE code = ?", args: [storeCode] });
      if (!storeResult.rows[0]) return response.status(404).json({ error: "No encontramos la tienda seleccionada." });
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

      const schedule = professional.scheduleDates?.find((entry) => entry.date === booking.date);
      let allowedSlots = professional.availableSlots ?? [];
      let scheduleEnd = null;
      if (schedule) {
        const start = /^([0-2]\d):([0-5]\d)$/.exec(schedule.start);
        const end = /^([0-2]\d):([0-5]\d)$/.exec(schedule.end);
        if (!start || !end) return response.status(400).json({ error: "El horario del profesional no es válido." });
        const firstMinute = Number(start[1]) * 60 + Number(start[2]);
        scheduleEnd = Number(end[1]) * 60 + Number(end[2]);
        allowedSlots = [];
        for (let minute = firstMinute; minute + 30 <= scheduleEnd; minute += 30) {
          allowedSlots.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
        }
      }
      if (!allowedSlots.includes(booking.time)) return response.status(400).json({ error: "Ese horario no está dentro de la disponibilidad del profesional." });
      const [hours, minutes] = booking.time.split(":").map(Number);
      const startMinute = hours * 60 + minutes;
      if (scheduleEnd !== null && startMinute + booking.duration > scheduleEnd) {
        return response.status(400).json({ error: "El turno excede el horario de atención del profesional." });
      }

      transaction = await db.transaction("write");
      const existingResult = await transaction.execute({ sql: "SELECT value FROM bookings" });
      const hasConflict = existingResult.rows.some((row) => {
        const existing = JSON.parse(String(row.value));
        if (normalizeStoreCode(existing.storeCode || DEFAULT_STORE_CODE) !== storeCode || existing.barberId !== booking.barberId || existing.date !== booking.date || existing.status === "cancelled") return false;
        const [existingHours, existingMinutes] = String(existing.time).split(":").map(Number);
        const existingStart = existingHours * 60 + existingMinutes;
        return startMinute < existingStart + Number(existing.duration)
          && existingStart < startMinute + booking.duration;
      });
      if (hasConflict) {
        await transaction.rollback();
        return response.status(409).json({ error: "Ese horario acaba de ser reservado. Elegí otro horario." });
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
  let storeCode = normalizeStoreCode(request.headers["x-store-code"]) || DEFAULT_STORE_CODE;
  try {
    if (user) {
      const accountRole = await db.execute({ sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?", args: [user.id] });
      if (!accountRole.rows[0] || !["admin", "client"].includes(String(accountRole.rows[0].role))) {
        return response.status(403).json({ error: "Configurá tu tipo de cuenta antes de guardar datos." });
      }
      role = accountRole.rows[0].role;
      if (role === "admin" && user.emailVerified) storeCode = normalizeStoreCode(accountRole.rows[0]?.store_code) || DEFAULT_STORE_CODE;
    }
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
        if (normalizeStoreCode(priorRecord.storeCode || DEFAULT_STORE_CODE) !== storeCode) {
          return response.status(403).json({ error: "El registro no pertenece a la tienda seleccionada." });
        }
      }
      if (body.collection === "bookings" && role !== "admin") {
        if (normalizeStoreCode(record.storeCode) !== storeCode) return response.status(403).json({ error: "La reserva no corresponde a la tienda seleccionada." });
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
      if (normalizeStoreCode(JSON.parse(String(existing.rows[0].value)).storeCode || DEFAULT_STORE_CODE) !== storeCode) {
        return response.status(403).json({ error: "El registro no pertenece a esta tienda." });
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
