import { createClient } from "@libsql/client";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { sendNotification, setVapidDetails } from "web-push";

const COLLECTIONS = ["bookings", "professionals"];
const FREE_TRIAL_DAYS = 4;
const BOOKING_SLOT_HOLD_MS = 5 * 60 * 1000;
const SUBSCRIPTION_PLANS = new Map([
  ["15d", { days: 15, months: 0, amount: 5999, label: "15 días" }],
  ["1m", { days: 0, months: 1, amount: 9999, label: "1 mes" }],
  ["2m", { days: 0, months: 2, amount: 14999, label: "2 meses" }],
  ["3m", { days: 0, months: 3, amount: 19999, label: "3 meses" }],
  ["4m", { days: 0, months: 4, amount: 25999, label: "4 meses" }],
  ["6m", { days: 0, months: 6, amount: 36999, label: "6 meses" }],
]);
let schemaReady;
let databaseReady;
let legacyInvitesRemoved = false;
let demoStoreRemoved = false;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta configurar ${name} en el servidor.`);
  return value;
}

function paymentCredentialEncryptionKey() {
  return createHash("sha256")
    .update(requiredEnv("MERCADOPAGO_CREDENTIALS_ENCRYPTION_KEY"), "utf8")
    .digest();
}

function encryptPaymentAccessToken(accessToken) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", paymentCredentialEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(accessToken, "utf8"), cipher.final()]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

function decryptPaymentAccessToken(value) {
  const [iv, authTag, encrypted] = String(value).split(".");
  if (!iv || !authTag || !encrypted)
    throw new Error("Las credenciales de Mercado Pago guardadas no se pueden leer.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    paymentCredentialEncryptionKey(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

async function getStorePaymentCredentials(db, storeCode) {
  const result = await db.execute({
    sql: "SELECT public_key, encrypted_access_token FROM store_payment_credentials WHERE store_code = ?",
    args: [normalizeStoreCode(storeCode)],
  });
  const credentials = result.rows[0];
  if (!credentials?.public_key || !credentials?.encrypted_access_token) {
    throw new Error("Esta sucursal todavía no configuró sus credenciales de Mercado Pago.");
  }
  return {
    publicKey: String(credentials.public_key),
    accessToken: decryptPaymentAccessToken(credentials.encrypted_access_token),
  };
}

function normalizeStoreCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function hasPendingRefund(booking) {
  return (
    booking.paymentCancellationStatus === "requested" &&
    Number(booking.refundAmount ?? booking.totalPrice) > 0
  );
}

function requiresRefundResolution(booking) {
  if (
    booking.status !== "cancelled" ||
    booking.paymentStatus !== "approved" ||
    booking.paymentCancellationStatus === "refunded"
  ) {
    return false;
  }
  if (booking.cancelledBy === "professional") return true;
  if (booking.cancelledBy === "client")
    return booking.clientCancellationRefundEligible === true;
  const policy = booking.cancellationPolicyAtBooking;
  return (
    !policy ||
    (!policy.noRefunds && policy.allowRefunds && Number(policy.refundPercent) > 0)
  );
}

function canDeleteBooking(booking) {
  if (hasPendingRefund(booking)) return false;
  const cancelledWithoutRefundEligibility =
    booking.status === "cancelled" &&
    booking.cancelledBy === "client" &&
    booking.clientCancellationRefundEligible !== true;
  if (
    Boolean(booking.paymentReportedAt) &&
    booking.paymentStatus !== "approved" &&
    !cancelledWithoutRefundEligibility
  )
    return false;

  if (booking.status === "cancelled") {
    return !requiresRefundResolution(booking);
  }

  if (booking.paymentStatus === "pending" || booking.status === "pending-payment") return false;
  return (
    booking.status === "completed" ||
    booking.paymentStatus === "approved" ||
    booking.paymentCancellationStatus === "refunded"
  );
}

function canArchiveBooking(booking) {
  if (hasPendingRefund(booking) || requiresRefundResolution(booking)) return false;
  if (booking.status === "cancelled" && booking.cancelledBy === "client") return true;
  return canDeleteBooking(booking);
}

async function archiveBookings(db, user, bookingIds) {
  if (!user.emailVerified)
    return { status: 403, body: { error: "Verificá tu correo antes de archivar turnos." } };
  if (
    !Array.isArray(bookingIds) ||
    bookingIds.length === 0 ||
    bookingIds.length > 2000 ||
    bookingIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 200)
  ) {
    return { status: 400, body: { error: "La lista de turnos para borrar no es válida." } };
  }
  const account = await db.execute({
    sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
    args: [user.id],
  });
  const role = String(account.rows[0]?.role ?? "");
  if (!account.rows[0] || !["admin", "client"].includes(role))
    return { status: 403, body: { error: "Configurá tu cuenta para archivar turnos." } };

  const uniqueIds = [...new Set(bookingIds.map((id) => id.trim()))];
  const rows = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 400) {
    const ids = uniqueIds.slice(offset, offset + 400);
    const result = await db.execute({
      sql: `SELECT id, value FROM bookings WHERE id IN (${ids.map(() => "?").join(",")})`,
      args: ids,
    });
    rows.push(...result.rows);
  }

  const rowsById = new Map(rows.map((row) => [String(row.id), row]));
  const storeCode = normalizeStoreCode(account.rows[0]?.store_code);
  const archiveField = role === "client" ? "clientArchivedAt" : "adminArchivedAt";
  const restoredField = role === "client" ? "clientRestoredAt" : "adminRestoredAt";
  const timestamp = new Date().toISOString();
  const candidates = [];
  const statements = [];
  for (const id of uniqueIds) {
    const row = rowsById.get(id);
    if (!row) continue;
    const storedValue = String(row.value);
    const booking = JSON.parse(storedValue);
    if (role === "client") {
      if (booking.customer?.email?.trim().toLowerCase() !== user.email)
        return { status: 403, body: { error: "Solo puedes archivar tus propios turnos." } };
    } else if (normalizeStoreCode(booking.storeCode) !== storeCode) {
      return { status: 403, body: { error: "El turno no corresponde a tu sucursal." } };
    }
    if (!canArchiveBooking(booking)) continue;
    if (booking[archiveField]) {
      candidates.push({ booking, needsUpdate: false });
      continue;
    }
    booking[archiveField] = timestamp;
    delete booking[restoredField];
    candidates.push({ booking, needsUpdate: true });
    statements.push({
      sql: "UPDATE bookings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND value = ?",
      args: [JSON.stringify(booking), id, storedValue],
    });
  }

  const results = statements.length ? await db.batch(statements, "write") : [];
  let resultIndex = 0;
  const archived = candidates.flatMap(({ booking, needsUpdate }) => {
    if (!needsUpdate) return [booking];
    return results[resultIndex++]?.rowsAffected > 0 ? [booking] : [];
  });
  return {
    status: 200,
    body: { bookings: archived, failedCount: uniqueIds.length - archived.length },
  };
}

async function restoreArchivedBookings(db, user, bookingIds) {
  if (!user.emailVerified)
    return { status: 403, body: { error: "Verificá tu correo antes de restaurar turnos." } };
  if (
    !Array.isArray(bookingIds) ||
    bookingIds.length === 0 ||
    bookingIds.length > 2000 ||
    bookingIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 200)
  ) {
    return { status: 400, body: { error: "La lista de turnos para restaurar no es válida." } };
  }
  const account = await db.execute({
    sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
    args: [user.id],
  });
  const role = String(account.rows[0]?.role ?? "");
  if (!account.rows[0] || !["admin", "client"].includes(role))
    return { status: 403, body: { error: "Configurá tu cuenta para restaurar turnos." } };

  const uniqueIds = [...new Set(bookingIds.map((id) => id.trim()))];
  const rows = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 400) {
    const ids = uniqueIds.slice(offset, offset + 400);
    const result = await db.execute({
      sql: `SELECT id, value FROM bookings WHERE id IN (${ids.map(() => "?").join(",")})`,
      args: ids,
    });
    rows.push(...result.rows);
  }

  const rowsById = new Map(rows.map((row) => [String(row.id), row]));
  const storeCode = normalizeStoreCode(account.rows[0]?.store_code);
  const archiveField = role === "client" ? "clientArchivedAt" : "adminArchivedAt";
  const restoredField = role === "client" ? "clientRestoredAt" : "adminRestoredAt";
  const restoredAt = new Date().toISOString();
  const candidates = [];
  const statements = [];
  for (const id of uniqueIds) {
    const row = rowsById.get(id);
    if (!row) continue;
    const storedValue = String(row.value);
    const booking = JSON.parse(storedValue);
    if (role === "client") {
      if (booking.customer?.email?.trim().toLowerCase() !== user.email)
        return { status: 403, body: { error: "Solo puedes restaurar tus propios turnos." } };
    } else if (normalizeStoreCode(booking.storeCode) !== storeCode) {
      return { status: 403, body: { error: "El turno no corresponde a tu sucursal." } };
    }
    const appointmentAt = Date.parse(`${booking.date}T${booking.time}:00-03:00`);
    const isAutomaticallyArchived =
      !booking[restoredField] &&
      (booking.status === "completed" ||
        booking.status === "no-show" ||
        (Number.isFinite(appointmentAt) && Date.now() >= appointmentAt + 24 * 60 * 60 * 1000));
    if (!booking[archiveField] && !isAutomaticallyArchived) continue;
    delete booking[archiveField];
    booking[restoredField] = restoredAt;
    candidates.push({ booking, storedValue });
    statements.push({
      sql: "UPDATE bookings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND value = ?",
      args: [JSON.stringify(booking), id, storedValue],
    });
  }

  const results = statements.length ? await db.batch(statements, "write") : [];
  const bookings = results.flatMap((result, index) =>
    result.rowsAffected > 0 ? [candidates[index].booking] : [],
  );
  return {
    status: 200,
    body: { bookings, failedCount: uniqueIds.length - bookings.length },
  };
}

async function permanentlyDeleteArchivedBookings(db, user, bookingIds) {
  if (!user.emailVerified)
    return { status: 403, body: { error: "Verificá tu correo antes de borrar turnos." } };
  if (
    !Array.isArray(bookingIds) ||
    bookingIds.length === 0 ||
    bookingIds.length > 2000 ||
    bookingIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 200)
  ) {
    return { status: 400, body: { error: "La lista de turnos para borrar no es válida." } };
  }
  const account = await db.execute({
    sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
    args: [user.id],
  });
  const role = String(account.rows[0]?.role ?? "");
  if (!account.rows[0] || !["admin", "client"].includes(role)) {
    return { status: 403, body: { error: "Configurá tu cuenta para borrar turnos." } };
  }
  const uniqueIds = [...new Set(bookingIds.map((id) => id.trim()))];
  const rows = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 400) {
    const ids = uniqueIds.slice(offset, offset + 400);
    const result = await db.execute({
      sql: `SELECT id, value FROM bookings WHERE id IN (${ids.map(() => "?").join(",")})`,
      args: ids,
    });
    rows.push(...result.rows);
  }

  const rowsById = new Map(rows.map((row) => [String(row.id), row]));
  const statements = [];
  const candidates = [];
  const storeCode = normalizeStoreCode(account.rows[0]?.store_code);
  for (const id of uniqueIds) {
    const row = rowsById.get(id);
    if (!row) continue;
    const storedValue = String(row.value);
    const booking = JSON.parse(storedValue);
    if (role === "client") {
      if (booking.customer?.email?.trim().toLowerCase() !== user.email) {
        return {
          status: 403,
          body: { error: "Solo puedes borrar definitivamente tus propios turnos." },
        };
      }
    } else if (normalizeStoreCode(booking.storeCode) !== storeCode) {
      return { status: 403, body: { error: "El turno no corresponde a tu sucursal." } };
    }

    const archiveField = role === "client" ? "clientArchivedAt" : "adminArchivedAt";
    const restoredField = role === "client" ? "clientRestoredAt" : "adminRestoredAt";
    const appointmentAt = Date.parse(`${booking.date}T${booking.time}:00-03:00`);
    const isAutomaticallyArchived =
      !booking[restoredField] &&
      (booking.status === "completed" ||
        booking.status === "no-show" ||
        (Number.isFinite(appointmentAt) && Date.now() >= appointmentAt + 24 * 60 * 60 * 1000));
    if ((!booking[archiveField] && !isAutomaticallyArchived) || !canDeleteBooking(booking))
      continue;

    booking[role === "client" ? "clientPermanentlyDeletedAt" : "adminPermanentlyDeletedAt"] =
      new Date().toISOString();
    candidates.push(booking);
    statements.push({
      sql: "UPDATE bookings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND value = ?",
      args: [JSON.stringify(booking), id, storedValue],
    });
  }

  if (!statements.length)
    return { status: 200, body: { bookings: [], failedCount: uniqueIds.length } };
  const results = await db.batch(statements, "write");
  const bookings = results.flatMap((result, index) =>
    result.rowsAffected > 0 ? [candidates[index]] : [],
  );
  return { status: 200, body: { bookings, failedCount: uniqueIds.length - bookings.length } };
}

function isBookingVisibleInMainList(booking, role) {
  const audience = role === "admin" ? "admin" : "client";
  if (booking[`${audience}PermanentlyDeletedAt`]) return false;
  const archivedAt = booking[`${audience}ArchivedAt`];
  const restoredAt = booking[`${audience}RestoredAt`];
  if (restoredAt) return true;
  if (archivedAt || booking.paymentCancellationStatus === "requested") return !archivedAt;
  if (booking.status === "completed" || booking.status === "no-show") return false;
  const appointmentAt = Date.parse(`${booking.date}T${booking.time}:00-03:00`);
  return !Number.isFinite(appointmentAt) || Date.now() < appointmentAt + 24 * 60 * 60 * 1000;
}

function isBookingVisibleInArchiveList(booking, role) {
  const audience = role === "admin" ? "admin" : "client";
  if (booking[`${audience}PermanentlyDeletedAt`] || booking[`${audience}RestoredAt`]) return false;
  if (booking[`${audience}ArchivedAt`]) return true;
  if (booking.paymentCancellationStatus === "requested") return false;
  if (booking.status === "completed" || booking.status === "no-show") return true;
  const appointmentAt = Date.parse(`${booking.date}T${booking.time}:00-03:00`);
  return Number.isFinite(appointmentAt) && Date.now() >= appointmentAt + 24 * 60 * 60 * 1000;
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

async function ensureStoreLogoColumn(db) {
  const columns = await db.execute("PRAGMA table_info(stores)");
  if (!columns.rows.some((column) => column.name === "logo")) {
    await db.execute("ALTER TABLE stores ADD COLUMN logo TEXT NOT NULL DEFAULT ''");
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
        if (
          codes.includes(code) ||
          codes.some((demoCode) => String(row.id).startsWith(`${demoCode}:`))
        ) {
          await transaction.execute({
            sql: "DELETE FROM professionals WHERE id = ?",
            args: [String(row.id)],
          });
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
    const source =
      settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
    const street =
      typeof source.street === "string"
        ? source.street
        : typeof source.address === "string"
          ? source.address
          : "";
    const height = typeof source.height === "string" ? source.height : "";
    const city = typeof source.city === "string" ? source.city : "";
    const province = typeof source.province === "string" ? source.province : "";
    const postalCode = typeof source.postalCode === "string" ? source.postalCode : "";
    const streetAddress = [street, height].filter(Boolean).join(" ");
    const cityPostalCode = [city, postalCode].filter(Boolean).join(" ");
    const address = [streetAddress, cityPostalCode, province].filter(Boolean).join(", ");
    return {
      address: address || (typeof source.address === "string" ? source.address : ""),
      street,
      height,
      city,
      province,
      postalCode,
      employees: typeof source.employees === "string" ? source.employees : "",
      description: typeof source.description === "string" ? source.description : "",
      googleMapsUrl: typeof source.googleMapsUrl === "string" ? source.googleMapsUrl : "",
      googleReviewUrl: typeof source.googleReviewUrl === "string" ? source.googleReviewUrl : "",
      googleRating:
        typeof source.googleRating === "number" &&
        source.googleRating >= 0 &&
        source.googleRating <= 5
          ? source.googleRating
          : null,
      googleReviewCount:
        Number.isInteger(source.googleReviewCount) && source.googleReviewCount >= 0
          ? source.googleReviewCount
          : 0,
      coverImage: typeof source.coverImage === "string" ? source.coverImage : "",
      whatsapp: typeof source.whatsapp === "string" ? source.whatsapp : "",
      instagram: typeof source.instagram === "string" ? source.instagram : "",
      transferHolder: typeof source.transferHolder === "string" ? source.transferHolder : "",
      transferBank: typeof source.transferBank === "string" ? source.transferBank : "",
      transferCbu: typeof source.transferCbu === "string" ? source.transferCbu : "",
      transferAlias: typeof source.transferAlias === "string" ? source.transferAlias : "",
      noRefunds: source.noRefunds === true,
      allowRefunds: source.allowRefunds !== false,
      refundPercent:
        Number.isInteger(source.refundPercent) &&
        source.refundPercent >= 0 &&
        source.refundPercent <= 100
          ? source.refundPercent
          : 100,
      cancellationWindowMinutes:
        Number.isInteger(source.cancellationWindowMinutes) &&
        source.cancellationWindowMinutes >= 0 &&
        source.cancellationWindowMinutes <= 10080
          ? source.cancellationWindowMinutes
          : 30,
      discountCoupons: Array.isArray(source.discountCoupons) ? source.discountCoupons : [],
      paymentPriceAdjustments:
        source.paymentPriceAdjustments && typeof source.paymentPriceAdjustments === "object"
          ? source.paymentPriceAdjustments
          : {
              efectivo: { mode: "none", percent: 0 },
              transferencia: { mode: "none", percent: 0 },
              "tarjeta o mercado pago": { mode: "none", percent: 0 },
            },
    };
  } catch {
    return {
      address: "",
      street: "",
      height: "",
      city: "",
      province: "",
      postalCode: "",
      employees: "",
      description: "",
      googleMapsUrl: "",
      googleReviewUrl: "",
      googleRating: null,
      googleReviewCount: 0,
      coverImage: "",
      whatsapp: "",
      instagram: "",
      transferHolder: "",
      transferBank: "",
      transferCbu: "",
      transferAlias: "",
      noRefunds: false,
      allowRefunds: true,
      refundPercent: 100,
      cancellationWindowMinutes: 30,
      discountCoupons: [],
      paymentPriceAdjustments: {
        efectivo: { mode: "none", percent: 0 },
        transferencia: { mode: "none", percent: 0 },
        "tarjeta o mercado pago": { mode: "none", percent: 0 },
      },
    };
  }
}

function validateStoreSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields = [
    "street",
    "height",
    "city",
    "province",
    "postalCode",
    "whatsapp",
    "instagram",
    "transferHolder",
    "transferBank",
    "transferCbu",
    "transferAlias",
  ];
  const settings = {};
  for (const field of fields) {
    const setting = value[field] ?? "";
    const maxLength =
      field === "street"
        ? 150
        : field === "height" || field === "postalCode"
          ? 20
          : field === "whatsapp"
            ? 25
            : field === "instagram"
              ? 100
              : 200;
    if (typeof setting !== "string" || setting.length > maxLength) return null;
    settings[field] = setting.trim();
  }
  const employees = value.employees ?? "";
  const description = value.description ?? "";
  const googleMapsUrl = value.googleMapsUrl ?? "";
  const googleReviewUrl = value.googleReviewUrl ?? "";
  const coverImage = value.coverImage ?? "";
  if (
    typeof employees !== "string" ||
    employees.length > 1000 ||
    typeof description !== "string" ||
    description.length > 2000 ||
    typeof googleMapsUrl !== "string" ||
    googleMapsUrl.length > 2048 ||
    !isGoogleMapsUrl(googleMapsUrl) ||
    typeof googleReviewUrl !== "string" ||
    googleReviewUrl.length > 2048 ||
    !isSecureExternalUrl(googleReviewUrl) ||
    typeof coverImage !== "string" ||
    coverImage.length > 2_800_000 ||
    (coverImage && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(coverImage))
  )
    return null;
  const googleRating = value.googleRating ?? null;
  const googleReviewCount = value.googleReviewCount ?? 0;
  if (
    (googleRating !== null &&
      (typeof googleRating !== "number" || googleRating < 0 || googleRating > 5)) ||
    !Number.isInteger(googleReviewCount) ||
    googleReviewCount < 0
  )
    return null;
  settings.employees = employees.trim();
  settings.description = description.trim();
  settings.googleMapsUrl = googleMapsUrl.trim();
  settings.googleReviewUrl = googleReviewUrl.trim();
  settings.googleRating = googleRating;
  settings.googleReviewCount = googleReviewCount;
  settings.coverImage = coverImage;
  if (settings.whatsapp && !/^\+?[0-9 ()-]{8,25}$/.test(settings.whatsapp)) return null;
  const noRefunds = value.noRefunds ?? false;
  const allowRefunds = value.allowRefunds ?? true;
  const refundPercent = value.refundPercent ?? 100;
  const cancellationWindowMinutes = value.cancellationWindowMinutes ?? 30;
  if (
    typeof noRefunds !== "boolean" ||
    typeof allowRefunds !== "boolean" ||
    !Number.isInteger(refundPercent) ||
    refundPercent < 0 ||
    refundPercent > 100 ||
    !Number.isInteger(cancellationWindowMinutes) ||
    cancellationWindowMinutes < 0 ||
    cancellationWindowMinutes > 10080
  )
    return null;
  settings.noRefunds = noRefunds;
  settings.allowRefunds = allowRefunds;
  settings.refundPercent = refundPercent;
  settings.cancellationWindowMinutes = cancellationWindowMinutes;
  const discountCoupons = value.discountCoupons ?? [];
  if (!Array.isArray(discountCoupons) || discountCoupons.length > 50) return null;
  const couponCodes = new Set();
  settings.discountCoupons = [];
  for (const coupon of discountCoupons) {
    if (!coupon || typeof coupon !== "object" || Array.isArray(coupon)) return null;
    const code = typeof coupon.code === "string" ? coupon.code.trim().toLocaleUpperCase("es-AR") : "";
    if (
      !/^[\p{L}\d_-]{3,32}$/u.test(code) ||
      couponCodes.has(code) ||
      !["percent", "fixed"].includes(coupon.discountType) ||
      !Number.isInteger(coupon.discountValue) ||
      coupon.discountValue < 1 ||
      (coupon.discountType === "percent" && coupon.discountValue > 100) ||
      (coupon.discountType === "fixed" && coupon.discountValue > 100000000) ||
      typeof coupon.active !== "boolean"
    )
      return null;
    couponCodes.add(code);
    settings.discountCoupons.push({
      code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      active: coupon.active,
    });
  }
  const paymentPriceAdjustments = value.paymentPriceAdjustments ?? {};
  if (
    !paymentPriceAdjustments ||
    typeof paymentPriceAdjustments !== "object" ||
    Array.isArray(paymentPriceAdjustments)
  )
    return null;
  settings.paymentPriceAdjustments = {};
  for (const method of ["efectivo", "transferencia", "tarjeta o mercado pago"]) {
    const adjustment = paymentPriceAdjustments[method] ?? { mode: "none", percent: 0 };
    if (
      !adjustment ||
      typeof adjustment !== "object" ||
      !["none", "discount", "surcharge"].includes(adjustment.mode) ||
      !Number.isInteger(adjustment.percent) ||
      adjustment.percent < 0 ||
      adjustment.percent > 100 ||
      (adjustment.mode !== "none" && adjustment.percent < 1) ||
      (adjustment.mode === "none" && adjustment.percent !== 0)
    )
      return null;
    settings.paymentPriceAdjustments[method] = {
      mode: adjustment.mode,
      percent: adjustment.percent,
    };
  }
  const streetAddress = [settings.street, settings.height].filter(Boolean).join(" ");
  const cityPostalCode = [settings.city, settings.postalCode].filter(Boolean).join(" ");
  settings.address = [streetAddress, cityPostalCode, settings.province].filter(Boolean).join(", ");
  return settings;
}

function isGoogleMapsUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["google.com", "www.google.com", "maps.google.com", "maps.app.goo.gl"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function isSecureExternalUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function getGoogleMapsRating(mapsUrl) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey || !mapsUrl) return { rating: null, reviewCount: 0 };
  try {
    let url = new URL(mapsUrl);
    for (let redirects = 0; redirects < 5 && url.hostname === "maps.app.goo.gl"; redirects += 1) {
      const shortLinkResponse = await fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: { Range: "bytes=0-0" },
        signal: AbortSignal.timeout(5000),
      });
      const location = shortLinkResponse.headers.get("location");
      await shortLinkResponse.body?.cancel().catch(() => undefined);
      if (!location) break;
      const nextUrl = new URL(location, url);
      if (!isGoogleMapsUrl(nextUrl.toString())) break;
      url = nextUrl;
    }
    const placeId =
      url.searchParams.get("query_place_id") ||
      url.searchParams.get("place_id") ||
      url.pathname.match(/!1s(ChIJ[A-Za-z0-9_-]+)/)?.[1];
    const headers = { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "rating,userRatingCount" };
    let response;
    if (placeId) {
      response = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
        { headers },
      );
    } else {
      const nameFromPath = decodeURIComponent(
        (url.pathname.split("/place/")[1] ?? url.pathname.split("/maps/search/")[1] ?? "").split(
          "/",
        )[0],
      );
      const placeName = (url.searchParams.get("query") || url.searchParams.get("q") || nameFromPath)
        .replaceAll("+", " ")
        .replaceAll("%20", " ");
      if (!placeName) return { rating: null, reviewCount: 0 };
      headers["X-Goog-FieldMask"] = "places.rating,places.userRatingCount";
      response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ textQuery: placeName, maxResultCount: 1 }),
      });
    }
    if (!response.ok) return { rating: null, reviewCount: 0 };
    const result = await response.json();
    const place = result.places?.[0] ?? result;
    return {
      rating: typeof place.rating === "number" ? place.rating : null,
      reviewCount: Number.isInteger(place.userRatingCount) ? place.userRatingCount : 0,
    };
  } catch {
    return { rating: null, reviewCount: 0 };
  }
}

function validateCancellationPolicy(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.noRefunds !== "boolean" ||
    typeof value.allowRefunds !== "boolean" ||
    !Number.isInteger(value.refundPercent) ||
    value.refundPercent < 0 ||
    value.refundPercent > 100 ||
    !Number.isInteger(value.cancellationWindowMinutes) ||
    value.cancellationWindowMinutes < 0 ||
    value.cancellationWindowMinutes > 10080
  )
    return null;
  return {
    noRefunds: value.noRefunds,
    allowRefunds: value.allowRefunds,
    refundPercent: value.refundPercent,
    cancellationWindowMinutes: value.cancellationWindowMinutes,
  };
}

async function getStoreCancellationPolicy(db, storeCode) {
  const result = await db.execute({
    sql: "SELECT settings FROM stores WHERE code = ?",
    args: [normalizeStoreCode(storeCode)],
  });
  if (!result.rows[0]) throw new Error("No encontramos la sucursal del turno.");
  return parseStoreSettings(result.rows[0].settings);
}

function snapshotCancellationPolicy(policy) {
  return {
    noRefunds: policy.noRefunds,
    allowRefunds: policy.allowRefunds,
    refundPercent: policy.refundPercent,
    cancellationWindowMinutes: policy.cancellationWindowMinutes,
  };
}

function calculateBookingPricing(servicePrices, paymentMethod, settings, couponCode = "") {
  const methods = ["efectivo", "transferencia", "tarjeta o mercado pago"];
  const configured = settings.paymentPriceAdjustments ?? {};
  const adjustment = methods.includes(paymentMethod)
    ? configured[paymentMethod] ?? { mode: "none", percent: 0 }
    : { mode: "none", percent: 0 };
  const basePrice = servicePrices.reduce((sum, price) => sum + Math.round(Number(price)), 0);
  const adjustedSubtotal = servicePrices.reduce((sum, price) => {
    const numericPrice = Number(price);
    if (adjustment.mode === "discount")
      return sum + Math.max(0, Math.round(numericPrice * (1 - adjustment.percent / 100)));
    if (adjustment.mode === "surcharge")
      return sum + Math.round(numericPrice * (1 + adjustment.percent / 100));
    return sum + Math.round(numericPrice);
  }, 0);
  const normalizedCode = typeof couponCode === "string" ? couponCode.trim().toLocaleUpperCase("es-AR") : "";
  const coupon = normalizedCode
    ? (settings.discountCoupons ?? []).find(
        (item) => item.active && item.code.toLocaleUpperCase("es-AR") === normalizedCode,
      )
    : null;
  if (normalizedCode && !coupon) return { error: "El cupón no es válido o ya no está activo." };
  const couponDiscountAmount = coupon
    ? Math.min(
        adjustedSubtotal,
        coupon.discountType === "percent"
          ? Math.round((adjustedSubtotal * coupon.discountValue) / 100)
          : coupon.discountValue,
      )
    : 0;
  return {
    basePrice,
    adjustedSubtotal,
    couponCode: coupon?.code ?? "",
    couponDiscountAmount,
    paymentAdjustmentAmount: adjustedSubtotal - basePrice,
    paymentAdjustmentMode: adjustment.mode,
    paymentAdjustmentPercent: adjustment.percent,
    totalPrice: Math.max(0, adjustedSubtotal - couponDiscountAmount),
    pricingPolicyAtBooking: {
      discountCoupons: settings.discountCoupons,
      paymentPriceAdjustments: settings.paymentPriceAdjustments,
    },
  };
}

function applyBookingPricing(booking, servicePrices, settings) {
  const pricing = calculateBookingPricing(
    servicePrices,
    booking.customer?.paymentMethod,
    settings,
    booking.couponCode ?? "",
  );
  if (pricing.error) return pricing;
  Object.assign(booking, pricing);
  return pricing;
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
  const db = createClient({
    url: requiredEnv("TURSO_DATABASE_URL"),
    authToken: requiredEnv("TURSO_AUTH_TOKEN"),
  });
  schemaReady ??= db
    .batch([
      `CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
      `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      recipient_key TEXT NOT NULL,
      store_code TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      read_at TEXT,
      prompted_at TEXT
    )`,
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint_hash TEXT PRIMARY KEY,
      recipient_key TEXT NOT NULL,
      subscription TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
      `CREATE TABLE IF NOT EXISTS booking_slot_holds (
      hold_id TEXT PRIMARY KEY,
      store_code TEXT NOT NULL,
      barber_id TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      duration INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
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
      `CREATE TABLE IF NOT EXISTS client_profiles (
      user_id TEXT PRIMARY KEY,
      phone TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
      `CREATE TABLE IF NOT EXISTS stores (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      logo TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
      `CREATE TABLE IF NOT EXISTS store_payment_credentials (
      store_code TEXT PRIMARY KEY,
      public_key TEXT NOT NULL DEFAULT '',
      encrypted_access_token TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      `CREATE TABLE IF NOT EXISTS subscription_discount_redemptions (
      owner_id TEXT PRIMARY KEY,
      promo_code TEXT NOT NULL,
      store_code TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('reserved', 'used')),
      subscription_order_id TEXT,
      redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
      "CREATE INDEX IF NOT EXISTS bookings_updated ON bookings(updated_at)",
      "CREATE INDEX IF NOT EXISTS bookings_store_code ON bookings(upper(json_extract(value, '$.storeCode')))",
      "CREATE INDEX IF NOT EXISTS notifications_recipient ON notifications(recipient_key, created_at)",
      "CREATE INDEX IF NOT EXISTS push_subscriptions_recipient ON push_subscriptions(recipient_key)",
      "CREATE INDEX IF NOT EXISTS booking_slot_holds_lookup ON booking_slot_holds(store_code, barber_id, date, expires_at)",
      "CREATE INDEX IF NOT EXISTS subscription_orders_store ON subscription_orders(store_code, created_at)",
      "CREATE INDEX IF NOT EXISTS subscription_discount_code ON subscription_discount_redemptions(promo_code, store_code)",
      "CREATE INDEX IF NOT EXISTS bookings_schedule_lookup ON bookings(upper(json_extract(value, '$.storeCode')), json_extract(value, '$.barberId'), json_extract(value, '$.date'))",
      "CREATE INDEX IF NOT EXISTS bookings_customer_email ON bookings(lower(trim(json_extract(value, '$.customer.email'))))",
      "CREATE UNIQUE INDEX IF NOT EXISTS subscription_orders_payment ON subscription_orders(mp_payment_id) WHERE mp_payment_id IS NOT NULL",
      "CREATE INDEX IF NOT EXISTS professionals_updated ON professionals(updated_at)",
    ])
    .then(() => undefined)
    .catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  databaseReady ??= (async () => {
    await schemaReady;
    await ensureRoleStoreColumn(db);
    await ensureStoreSettingsColumn(db);
    await ensureStoreLogoColumn(db);
    await ensureStoreSubscriptionColumn(db);
    await ensureSubscriptionOrderDurationColumn(db);
    await removeDemoStore(db);
    if (!legacyInvitesRemoved) {
      await db.execute("DROP TABLE IF EXISTS admin_invites");
      legacyInvitesRemoved = true;
    }
  })().catch((error) => {
    databaseReady = undefined;
    throw error;
  });
  await databaseReady;
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
  return (
    typeof expiresAt === "string" &&
    Number.isFinite(Date.parse(expiresAt)) &&
    Date.parse(expiresAt) > Date.now()
  );
}

export async function listPublicSitemapStores() {
  const db = await database();
  const result = await db.execute(
    "SELECT code, name, owner_id, subscription_expires_at FROM stores ORDER BY name COLLATE NOCASE",
  );
  return result.rows
    .filter(
      (row) =>
        String(row.owner_id) !== "legacy" &&
        isSubscriptionActive(row.subscription_expires_at) &&
        Boolean(String(row.name ?? "").trim()) &&
        Boolean(String(row.code ?? "").trim()),
    )
    .map((row) => ({ code: String(row.code), name: String(row.name) }));
}

export function subscriptionPromoDiscountPercent(code) {
  const normalizedCode = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!normalizedCode) return 0;

  const discountCodes = [
    "PROMO10NUEVO",
    ...(process.env.DESCUENTO_OFF ?? "")
      .split(",")
      .map((configuredCode) => configuredCode.trim().toUpperCase())
      .filter(Boolean),
  ];
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
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) throw new Error("No se pudo verificar el pago en Mercado Pago.");
  const payment = await response.json();
  if (payment.status !== "approved") return { approved: false };
  if (payment.currency_id !== "ARS") throw new Error("La moneda del pago no coincide con ARS.");
  const purchaseId =
    typeof payment.external_reference === "string" ? payment.external_reference : "";
  if (!purchaseId) throw new Error("El pago no está asociado a una compra de suscripción.");

  const transaction = await db.transaction("write");
  try {
    const result = await transaction.execute({
      sql: "SELECT id, store_code, owner_id, months, duration_days, amount, status FROM subscription_orders WHERE id = ? AND method = 'mercadopago'",
      args: [purchaseId],
    });
    const order = result.rows[0];
    if (!order) throw new Error("No encontramos la compra de suscripción asociada al pago.");
    if (expectedOwnerId && String(order.owner_id) !== expectedOwnerId)
      throw new Error("El pago no corresponde a tu cuenta.");
    if (Number(payment.transaction_amount) !== Number(order.amount))
      throw new Error("El importe pagado no coincide con el plan.");
    if (order.status === "paid") {
      const store = await transaction.execute({
        sql: "SELECT subscription_expires_at FROM stores WHERE code = ?",
        args: [String(order.store_code)],
      });
      await transaction.commit();
      return { approved: true, expiresAt: store.rows[0]?.subscription_expires_at ?? null };
    }
    if (order.status !== "pending") throw new Error("La compra de suscripción no está pendiente.");

    const storeResult = await transaction.execute({
      sql: "SELECT subscription_expires_at FROM stores WHERE code = ?",
      args: [String(order.store_code)],
    });
    if (!storeResult.rows[0]) throw new Error("No encontramos la sucursal de esta suscripción.");
    const currentExpiry = String(storeResult.rows[0].subscription_expires_at ?? "");
    const startDate =
      currentExpiry && Date.parse(currentExpiry) > Date.now()
        ? currentExpiry
        : new Date().toISOString();
    const expiresAt =
      Number(order.duration_days) > 0
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
    await transaction.execute({
      sql: "UPDATE subscription_discount_redemptions SET status = 'used' WHERE subscription_order_id = ? AND owner_id = ? AND status = 'reserved'",
      args: [purchaseId, String(order.owner_id)],
    });
    await transaction.commit();
    return { approved: true, expiresAt };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}

async function releaseDiscountReservationForFailedOrder(db, orderId) {
  if (!orderId) return;
  const transaction = await db.transaction("write");
  try {
    await transaction.execute({
      sql: "UPDATE subscription_orders SET status = 'failed' WHERE id = ? AND status = 'pending'",
      args: [orderId],
    });
    await transaction.execute({
      sql: "UPDATE subscription_discount_redemptions SET subscription_order_id = NULL WHERE subscription_order_id = ? AND status = 'reserved'",
      args: [orderId],
    });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}

async function verifySubscriptionPurchase(db, purchaseId, expectedOwnerId) {
  if (typeof purchaseId !== "string" || !/^[a-f0-9]{36}$/.test(purchaseId))
    throw new Error("Identificador de compra inválido.");
  const accessToken = requiredEnv("MERCADOPAGO_ACCESS_TOKEN");
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(purchaseId)}&sort=date_created&criteria=desc`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) throw new Error("No se pudo consultar el estado del pago en Mercado Pago.");
  const result = await response.json();
  const approvedPayment = result.results?.find((payment) => payment.status === "approved");
  if (!approvedPayment) return { approved: false };
  return verifyMercadoPagoPayment(db, String(approvedPayment.id), expectedOwnerId);
}

async function findApprovedMercadoPagoPayment(bookingId, paymentId, accessToken) {
  const endpoint = paymentId
    ? `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`
    : `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(bookingId)}&sort=date_created&criteria=desc`;
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("No se pudo verificar el pago en Mercado Pago.");
  const result = await response.json();
  const payment = paymentId ? result : result.results?.find((item) => item.status === "approved");
  if (!payment || payment.status !== "approved") return null;
  if (payment.currency_id !== "ARS" || String(payment.external_reference) !== bookingId) {
    throw new Error("El pago no coincide con la reserva.");
  }
  return payment;
}

async function verifyBookingPayment(db, bookingId, paymentId) {
  if (typeof bookingId !== "string" || !/^[\da-f-]{36}$/i.test(bookingId)) {
    throw new Error("Identificador de reserva inválido.");
  }
  const bookingResult = await db.execute({
    sql: "SELECT value FROM bookings WHERE id = ?",
    args: [bookingId],
  });
  if (!bookingResult.rows[0]) throw new Error("No encontramos el turno asociado al pago.");
  const existingBooking = JSON.parse(String(bookingResult.rows[0].value));
  if (["requested", "cancelled", "refunded"].includes(existingBooking.paymentCancellationStatus)) {
    throw new Error("El cliente ya solicitó la devolución de este pago.");
  }
  if (existingBooking.customer?.paymentMethod !== "tarjeta o mercado pago") {
    throw new Error("La reserva no corresponde a un pago con Mercado Pago.");
  }
  const bookingSummary = {
    date: String(existingBooking.date ?? ""),
    time: String(existingBooking.time ?? ""),
    totalPrice: Number(existingBooking.totalPrice ?? 0),
    storeCode: normalizeStoreCode(existingBooking.storeCode),
  };
  const credentials = await getStorePaymentCredentials(db, existingBooking.storeCode);
  const payment = await findApprovedMercadoPagoPayment(
    bookingId,
    paymentId,
    credentials.accessToken,
  );
  if (!payment) return { approved: false, booking: bookingSummary };

  const transaction = await db.transaction("write");
  const notifications = [];
  try {
    const result = await transaction.execute({
      sql: "SELECT value FROM bookings WHERE id = ?",
      args: [bookingId],
    });
    if (!result.rows[0]) throw new Error("No encontramos el turno asociado al pago.");
    const booking = JSON.parse(String(result.rows[0].value));
    if (booking.customer?.paymentMethod !== "tarjeta o mercado pago") {
      throw new Error("La reserva no corresponde a un pago con Mercado Pago.");
    }
    if (Number(payment.transaction_amount) !== Number(booking.totalPrice)) {
      throw new Error("El importe pagado no coincide con el total del turno.");
    }
    if (booking.status === "confirmed" && booking.paymentStatus === "approved") {
      await transaction.commit();
      return { approved: true, booking: bookingSummary };
    }
    if (
      !["confirmed", "pending-payment"].includes(booking.status) ||
      booking.paymentStatus === "approved"
    ) {
      throw new Error("La reserva ya no está pendiente de pago.");
    }

    booking.status = "confirmed";
    booking.paymentStatus = "approved";
    booking.mercadoPagoPaymentId = String(payment.id);
    delete booking.cancellationToken;
    const updated = await transaction.execute({
      sql: "UPDATE bookings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [JSON.stringify(booking), bookingId],
    });
    if (!updated.rowsAffected)
      throw Object.assign(new Error("El turno cambió mientras se verificaba el pago."), {
        statusCode: 409,
      });
    const paymentNotice = notificationForClient(
      booking,
      "payment_confirmed",
      "Pago confirmado",
      "Mercado Pago confirmó el pago de tu turno.",
    );
    const adminPaymentNotice = notificationForAdmin(
      booking,
      "payment_confirmed",
      "Pago recibido",
      `Mercado Pago aprobó el pago de ${booking.customer?.fullName || "un cliente"}.`,
    );
    if (paymentNotice) {
      await persistNotification(transaction, paymentNotice);
      notifications.push(paymentNotice);
    }
    if (adminPaymentNotice) {
      await persistNotification(transaction, adminPaymentNotice);
      notifications.push(adminPaymentNotice);
    }
    await transaction.commit();
    for (const notice of notifications) await sendPushForNotification(db, notice);
    return { approved: true, booking: bookingSummary };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}

async function processMercadoPagoNotification(db, paymentId) {
  if (!/^\d{1,30}$/.test(String(paymentId))) throw new Error("Identificador de pago inválido.");
  const accessToken = requiredEnv("MERCADOPAGO_ACCESS_TOKEN");
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) throw new Error("No se pudo verificar el pago en Mercado Pago.");
  const payment = await response.json();
  const reference =
    typeof payment.external_reference === "string" ? payment.external_reference : "";
  if (!reference || payment.status !== "approved") return { approved: false };

  const subscription = await db.execute({
    sql: "SELECT id FROM subscription_orders WHERE id = ?",
    args: [reference],
  });
  if (subscription.rows[0]) return verifyMercadoPagoPayment(db, String(paymentId));
  return verifyBookingPayment(db, reference, String(paymentId));
}

function recordId(record) {
  return record &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    typeof record.id === "string" &&
    record.id.length > 0 &&
    record.id.length <= 200
    ? record.id
    : null;
}

function notificationStatement(recipientKey, booking, type, title, message) {
  return {
    sql: "INSERT INTO notifications (id, recipient_key, store_code, booking_id, type, title, message) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [
      randomBytes(16).toString("hex"),
      recipientKey,
      normalizeStoreCode(booking.storeCode),
      String(booking.id),
      type,
      title,
      message,
    ],
  };
}

function webPushConfiguration() {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.WEB_PUSH_SUBJECT?.trim() ?? "";
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

function validPushSubscription(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const endpoint = typeof value.endpoint === "string" ? value.endpoint : "";
  const keys = value.keys;
  if (
    endpoint.length > 4096 ||
    !keys ||
    typeof keys !== "object" ||
    typeof keys.p256dh !== "string" ||
    typeof keys.auth !== "string" ||
    !/^[A-Za-z0-9_-]{20,256}$/.test(keys.p256dh) ||
    !/^[A-Za-z0-9_-]{10,128}$/.test(keys.auth)
  )
    return false;
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "fcm.googleapis.com" ||
        url.hostname === "web.push.apple.com" ||
        url.hostname.endsWith(".push.services.mozilla.com") ||
        url.hostname.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}

async function sendPushForNotification(executor, statement) {
  const configuration = webPushConfiguration();
  if (!configuration || !statement) return;
  const [notificationId, recipientKey, , bookingId, , title, message] = statement.args;
  try {
    const result = await executor.execute({
      sql: "SELECT endpoint_hash, subscription FROM push_subscriptions WHERE recipient_key = ?",
      args: [recipientKey],
    });
    if (!result.rows.length) return;
    setVapidDetails(configuration.subject, configuration.publicKey, configuration.privateKey);
    const payload = JSON.stringify({
      title: String(title),
      body: String(message).slice(0, 300),
      tag: `booking-${String(bookingId)}`,
      url: String(recipientKey).startsWith("admin:") ? "/agenda" : "/mis-turnos",
      notificationId: String(notificationId),
    });
    await Promise.all(
      result.rows.map(async (row) => {
        try {
          const subscription = JSON.parse(String(row.subscription));
          if (!validPushSubscription(subscription)) throw new Error("Suscripción push inválida.");
          await sendNotification(subscription, payload, { TTL: 120, urgency: "high" });
        } catch (error) {
          const statusCode = Number(error?.statusCode);
          if (statusCode === 404 || statusCode === 410) {
            await executor.execute({
              sql: "DELETE FROM push_subscriptions WHERE endpoint_hash = ?",
              args: [String(row.endpoint_hash)],
            });
          } else {
            console.error("No se pudo enviar una notificación push", error);
          }
        }
      }),
    );
  } catch (error) {
    console.error("No se pudieron consultar las suscripciones push", error);
  }
}

async function persistNotification(executor, statement) {
  if (!statement) return;
  await executor.execute(statement);
}

async function withWriteTransaction(db, operation) {
  const transaction = await db.transaction("write");
  try {
    const result = await operation(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback().catch((rollbackError) => {
      console.error("No se pudo revertir la transacción de escritura", rollbackError);
    });
    throw error;
  }
}

async function assertStoreAdmin(transaction, userId, storeCode) {
  const account = await transaction.execute({
    sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
    args: [userId],
  });
  if (
    account.rows[0]?.role !== "admin" ||
    normalizeStoreCode(account.rows[0]?.store_code) !== storeCode
  ) {
    throw Object.assign(new Error("Solo el administrador de la sucursal puede modificarla."), {
      statusCode: 403,
    });
  }
}

async function updateStoreSettings(db, storeCode, userId, update, requireOwner = false) {
  return withWriteTransaction(db, async (transaction) => {
    await assertStoreAdmin(transaction, userId, storeCode);
    const store = await transaction.execute({
      sql: requireOwner
        ? "SELECT settings FROM stores WHERE code = ? AND owner_id = ?"
        : "SELECT settings FROM stores WHERE code = ?",
      args: requireOwner ? [storeCode, userId] : [storeCode],
    });
    if (!store.rows[0])
      throw Object.assign(new Error("No encontramos la sucursal."), { statusCode: 404 });

    const settings = update(parseStoreSettings(store.rows[0].settings));
    const saved = await transaction.execute({
      sql: requireOwner
        ? "UPDATE stores SET settings = ? WHERE code = ? AND owner_id = ?"
        : "UPDATE stores SET settings = ? WHERE code = ?",
      args: requireOwner
        ? [JSON.stringify(settings), storeCode, userId]
        : [JSON.stringify(settings), storeCode],
    });
    if (!saved.rowsAffected)
      throw Object.assign(
        new Error("La sucursal cambió en otra operación. Actualizá e intentá de nuevo."),
        { statusCode: 409 },
      );
    return settings;
  });
}

async function persistBookingUpdate(db, bookingId, previousValue, booking, notice = null) {
  const transaction = await db.transaction("write");
  try {
    const update = await transaction.execute({
      sql: "UPDATE bookings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND value = ?",
      args: [JSON.stringify(booking), bookingId, previousValue],
    });
    if (!update.rowsAffected)
      throw Object.assign(new Error("El turno cambió en otra operación. Actualizá e intentá de nuevo."), {
        statusCode: 409,
      });
    if (notice) await persistNotification(transaction, notice);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
  if (notice) await sendPushForNotification(db, notice);
}

function notificationForAdmin(booking, type, title, message) {
  const storeCode = normalizeStoreCode(booking.storeCode);
  return storeCode
    ? notificationStatement(`admin:${storeCode}`, booking, type, title, message)
    : null;
}

function notificationForClient(booking, type, title, message) {
  const email = booking.customer?.email?.trim().toLowerCase();
  return email ? notificationStatement(`client:${email}`, booking, type, title, message) : null;
}

function describeAdminBookingChange(previous, next) {
  if (
    previous.paymentCancellationStatus !== next.paymentCancellationStatus &&
    next.paymentCancellationStatus === "refunded"
  ) {
    return [
      "payment_refunded",
      "Devolución realizada",
      `El profesional confirmó la devolución de $${Number(next.refundAmount ?? next.totalPrice).toLocaleString("es-AR")}.`,
    ];
  }
  if (previous.date !== next.date || previous.time !== next.time) {
    return [
      "booking_changed",
      "Turno modificado",
      `El profesional modificó el turno para ${next.date} a las ${next.time}.`,
    ];
  }
  if (previous.status !== next.status && next.status === "cancelled") {
    return ["booking_cancelled", "Turno cancelado", "El profesional canceló tu turno."];
  }
  if (previous.paymentStatus !== "approved" && next.paymentStatus === "approved") {
    return ["payment_confirmed", "Pago confirmado", "El profesional confirmó el pago de tu turno."];
  }
  if (previous.customer?.paymentMethod !== next.customer?.paymentMethod) {
    return [
      "payment_method_changed",
      "Método de pago modificado",
      `El método de pago cambió a ${next.customer?.paymentMethod ?? "sin especificar"}.`,
    ];
  }
  if (
    previous.status !== next.status ||
    previous.appointmentConfirmation !== next.appointmentConfirmation
  ) {
    return [
      "booking_status_changed",
      "Estado del turno actualizado",
      "El profesional actualizó el estado de tu turno.",
    ];
  }
  return null;
}

async function updateAdminBooking(db, user, body) {
  if (!user.emailVerified)
    return { status: 403, body: { error: "Verificá tu correo antes de modificar turnos." } };
  const account = await db.execute({
    sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
    args: [user.id],
  });
  if (account.rows[0]?.role !== "admin")
    return { status: 403, body: { error: "Solo un profesional puede actualizar turnos." } };
  const storeCode = normalizeStoreCode(account.rows[0]?.store_code);
  const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : "";
  const patch = body.patch;
  if (!bookingId || bookingId.length > 200)
    return { status: 400, body: { error: "Identificador de turno inválido." } };
  const allowedFields = new Set([
    "status",
    "paymentStatus",
    "cancelledBy",
    "barberId",
    "serviceIds",
    "duration",
    "totalPrice",
    "date",
    "time",
  ]);
  if (
    !patch ||
    typeof patch !== "object" ||
    Array.isArray(patch) ||
    !Object.keys(patch).length ||
    Object.keys(patch).some((field) => !allowedFields.has(field))
  ) {
    return { status: 400, body: { error: "Los cambios del turno no son válidos." } };
  }

  const transaction = await db.transaction("write");
  let notificationToSend = null;
  try {
    const stored = await transaction.execute({
      sql: "SELECT value FROM bookings WHERE id = ?",
      args: [bookingId],
    });
    if (!stored.rows[0])
      throw Object.assign(new Error("No encontramos ese turno."), { statusCode: 404 });
    const previous = JSON.parse(String(stored.rows[0].value));
    if (!storeCode || normalizeStoreCode(previous.storeCode) !== storeCode) {
      throw Object.assign(new Error("El turno no corresponde a tu sucursal."), { statusCode: 403 });
    }

    const booking = { ...previous, ...patch };
    const validStatuses = new Set([
      "pending-payment",
      "confirmed",
      "cancelled",
      "completed",
      "no-show",
    ]);
    if (patch.status !== undefined && !validStatuses.has(patch.status)) {
      throw Object.assign(new Error("El estado del turno no es válido."), { statusCode: 400 });
    }
    if (
      patch.status === "cancelled" &&
      ["confirmed", "pending-payment"].includes(previous.status)
    ) {
      const appointmentAt =
        /^\d{4}-\d{2}-\d{2}$/.test(previous.date) &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(previous.time)
          ? Date.parse(`${previous.date}T${previous.time}:00-03:00`)
          : Number.NaN;
      if (!Number.isFinite(appointmentAt) || appointmentAt <= Date.now()) {
        throw Object.assign(
          new Error("No se puede cancelar un turno que ya comenzó o cuya fecha no es válida."),
          { statusCode: 409 },
        );
      }
    }
    if (
      patch.paymentStatus !== undefined &&
      !["pending", "approved"].includes(patch.paymentStatus)
    ) {
      throw Object.assign(new Error("El estado del pago no es válido."), { statusCode: 400 });
    }
    if (
      patch.cancelledBy !== undefined &&
      !["client", "professional"].includes(patch.cancelledBy)
    ) {
      throw Object.assign(new Error("El origen de la cancelación no es válido."), {
        statusCode: 400,
      });
    }
    if (["completed", "no-show"].includes(booking.status) && booking.paymentStatus !== "approved") {
      throw Object.assign(
        new Error(
          "Solo puedes indicar asistencia en turnos con el pago confirmado por el administrador.",
        ),
        { statusCode: 409 },
      );
    }
    if (
      patch.paymentStatus === "approved" &&
      !["confirmed", "pending-payment"].includes(previous.status)
    ) {
      throw Object.assign(new Error("Este turno ya no está pendiente de pago."), {
        statusCode: 409,
      });
    }
    if (booking.status === "cancelled" && !patch.cancelledBy) booking.cancelledBy = "professional";

    const editFields = ["barberId", "serviceIds", "duration", "totalPrice", "date", "time"];
    if (editFields.some((field) => Object.hasOwn(patch, field))) {
      const barberId = typeof booking.barberId === "string" ? booking.barberId.trim() : "";
      const serviceIds = Array.isArray(booking.serviceIds)
        ? booking.serviceIds.map((serviceId) =>
            typeof serviceId === "string" ? serviceId.trim() : "",
          )
        : [];
      if (
        !barberId ||
        barberId.length > 200 ||
        serviceIds.length === 0 ||
        serviceIds.length > 20 ||
        serviceIds.some((serviceId) => !serviceId || serviceId.length > 200) ||
        new Set(serviceIds).size !== serviceIds.length
      ) {
        throw Object.assign(new Error("Elegí un profesional y servicios válidos."), {
          statusCode: 400,
        });
      }
      const professionalResult = await transaction.execute({
        sql: "SELECT value FROM professionals WHERE id = ?",
        args: [storedRecordId(storeCode, barberId)],
      });
      if (!professionalResult.rows[0])
        throw Object.assign(new Error("El profesional elegido ya no está disponible."), {
          statusCode: 409,
        });
      const professional = JSON.parse(String(professionalResult.rows[0].value));
      const services = serviceIds.map((serviceId) =>
        professional.services?.find((item) => item.id === serviceId),
      );
      if (services.some((service) => !service))
        throw Object.assign(new Error("Uno de los servicios elegidos ya no está disponible."), {
          statusCode: 409,
        });
      booking.barberId = barberId;
      booking.serviceIds = serviceIds;
      booking.duration = services.reduce((total, service) => total + Number(service.duration), 0);
      const pricing = applyBookingPricing(
        booking,
        services.map((service) => service.price),
        booking.pricingPolicyAtBooking ?? { discountCoupons: [], paymentPriceAdjustments: {} },
      );
      if (pricing.error)
        throw Object.assign(new Error(pricing.error), { statusCode: 409 });
      const availabilityError = await validateBookingAvailability(
        transaction,
        booking,
        storeCode,
        bookingId,
      );
      if (availabilityError) throw Object.assign(new Error(availabilityError), { statusCode: 409 });
    }

    const updated = await transaction.execute({
      sql: "UPDATE bookings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [JSON.stringify(booking), bookingId],
    });
    if (!updated.rowsAffected)
      throw Object.assign(new Error("El turno cambió en otra operación. Actualizá e intentá de nuevo."), {
        statusCode: 409,
      });
    const change = describeAdminBookingChange(previous, booking);
    if (change) {
      const notice = notificationForClient(booking, change[0], change[1], change[2]);
      if (notice) {
        await persistNotification(transaction, notice);
        notificationToSend = notice;
      }
    }
    await transaction.commit();
    if (notificationToSend) await sendPushForNotification(db, notificationToSend);
    return { status: 200, body: { booking } };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    return {
      status: Number.isInteger(error?.statusCode) ? error.statusCode : 500,
      body: { error: error instanceof Error ? error.message : "No se pudo actualizar el turno." },
    };
  }
}

function scheduleForDate(professional, date) {
  const override = professional.scheduleDates?.find((entry) => entry.date === date);
  if (override) return override;
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (!professional.weeklySchedule?.length) return null;
  return (
    professional.weeklySchedule.find((entry) => entry.dayOfWeek === dayOfWeek) ?? {
      date,
      start: "",
      end: "",
      closed: true,
    }
  );
}

async function saveProfessionalRecords(db, records, deleteIds, storeCode) {
  const transaction = await db.transaction("write");
  const notifications = [];
  try {
    for (const record of records) {
      const id = recordId(record);
      if (!id)
        throw Object.assign(new Error("Hay un registro con identificador inválido."), {
          statusCode: 400,
        });
      record.storeCode = storeCode;
      const databaseId = storedRecordId(storeCode, id);
      const storedResult = await transaction.execute({
        sql: "SELECT value FROM professionals WHERE id = ?",
        args: [databaseId],
      });
      const priorProfessional = storedResult.rows[0]
        ? JSON.parse(String(storedResult.rows[0].value))
        : null;
      if (priorProfessional && normalizeStoreCode(priorProfessional.storeCode) !== storeCode) {
        throw Object.assign(new Error("El registro no pertenece a la sucursal seleccionada."), {
          statusCode: 403,
        });
      }

      if (priorProfessional) {
        const bookingsResult = await transaction.execute("SELECT id, value FROM bookings");
        const now = Date.now();
        const affectedBookings = [];
        for (const row of bookingsResult.rows) {
          const booking = JSON.parse(String(row.value));
          if (
            booking.barberId !== id ||
            normalizeStoreCode(booking.storeCode) !== storeCode ||
            !["confirmed", "pending-payment"].includes(booking.status)
          )
            continue;
          const appointmentAt = Date.parse(`${booking.date}T${booking.time}:00-03:00`);
          if (Number.isFinite(appointmentAt) && appointmentAt <= now) continue;

          const previousSchedule = scheduleForDate(priorProfessional, booking.date);
          const nextSchedule = scheduleForDate(record, booking.date);
          if (JSON.stringify(previousSchedule) === JSON.stringify(nextSchedule)) continue;
          if (bookingFitsProfessionalSchedule(record, booking)) continue;
          affectedBookings.push({ row, booking });
        }

        const paidBooking = affectedBookings.find(
          ({ booking }) => booking.paymentStatus === "approved",
        );
        if (paidBooking) {
          const date = paidBooking.booking.date;
          const bookingCount = affectedBookings.filter(
            ({ booking }) => booking.date === date,
          ).length;
          const formattedDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
            ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
            : date;
          const bookingLabel = bookingCount === 1 ? "1 turno" : `${bookingCount} turnos`;
          const reason =
            bookingCount === 1 ? "tiene un pago aprobado" : "al menos uno tiene un pago aprobado";
          const nextStep =
            bookingCount === 1
              ? "Reprogramá el turno o gestioná su devolución"
              : "Reprogramá los turnos o gestioná sus devoluciones";
          throw Object.assign(
            new Error(
              `No se puede guardar el horario del ${formattedDate}: hay ${bookingLabel} programado${bookingCount === 1 ? "" : "s"} para ese día, fuera del nuevo horario, y ${reason}. ${nextStep} antes de guardar.`,
            ),
            { statusCode: 409 },
          );
        }

        for (const { row, booking } of affectedBookings) {
          booking.status = "cancelled";
          booking.cancelledBy = "professional";
          const updated = await transaction.execute({
            sql: "UPDATE bookings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            args: [JSON.stringify(booking), String(row.id)],
          });
          if (!updated.rowsAffected)
            throw Object.assign(new Error("Un turno cambió mientras se actualizaba el horario."), {
              statusCode: 409,
            });
          const notice = notificationForClient(
            booking,
            "booking_cancelled",
            "Turno cancelado",
            "El profesional canceló tu turno porque no atenderá en esa fecha.",
          );
          if (notice) {
            await persistNotification(transaction, notice);
            notifications.push(notice);
          }
        }
      }

      await transaction.execute({
        sql: "INSERT INTO professionals (id, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
        args: [databaseId, JSON.stringify(record)],
      });
    }

    for (const id of deleteIds) {
      const databaseId = storedRecordId(storeCode, id);
      const existing = await transaction.execute({
        sql: "SELECT value FROM professionals WHERE id = ?",
        args: [databaseId],
      });
      if (!existing.rows[0]) continue;
      if (normalizeStoreCode(JSON.parse(String(existing.rows[0].value)).storeCode) !== storeCode) {
        throw Object.assign(new Error("El registro no pertenece a esta sucursal."), {
          statusCode: 403,
        });
      }
      await transaction.execute({
        sql: "DELETE FROM professionals WHERE id = ?",
        args: [databaseId],
      });
    }

    await transaction.commit();
    for (const notice of notifications) await sendPushForNotification(db, notice);
    return { status: 200, body: { ok: true } };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    return {
      status: Number.isInteger(error?.statusCode) ? error.statusCode : 500,
      body: {
        error: error instanceof Error ? error.message : "No se pudieron guardar los profesionales.",
      },
    };
  }
}

function bookingCapacityForDate(professional, date) {
  const schedule = scheduleForDate(professional, date);
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
  const weeklySchedule = professional.weeklySchedule?.find(
    (entry) => entry.dayOfWeek === dayOfWeek,
  );
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
    slots.push(
      `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
    );
  }
  return { slots, endMinute };
}

function bookingFitsProfessionalSchedule(professional, booking) {
  const schedule = scheduleForDate(professional, booking.date);
  if (!schedule) return (professional.availableSlots ?? []).includes(booking.time);
  if (schedule.closed) return false;
  const generated = scheduleSlots(schedule);
  if (!generated || !generated.slots.includes(booking.time)) return false;
  const [hours, minutes] = String(booking.time).split(":").map(Number);
  const startMinute = hours * 60 + minutes;
  const duration = Number(booking.duration);
  return Number.isFinite(duration) && duration > 0 && startMinute + duration <= generated.endMinute;
}

async function hasBookingConflict(
  db,
  booking,
  storeCode,
  capacity = 1,
  bookingId = "",
  holdId = "",
) {
  const existingResult = await db.execute({
    sql: `SELECT json_extract(value, '$.time') AS time,
        json_extract(value, '$.duration') AS duration
      FROM bookings
      WHERE upper(json_extract(value, '$.storeCode')) = ?
        AND json_extract(value, '$.barberId') = ?
        AND json_extract(value, '$.date') = ?
        AND json_extract(value, '$.status') <> 'cancelled'
        AND id <> ?
      UNION ALL
      SELECT time, duration FROM booking_slot_holds
      WHERE store_code = ? AND barber_id = ? AND date = ?
        AND expires_at > ? AND hold_id <> ?`,
    args: [
      storeCode,
      booking.barberId,
      booking.date,
      bookingId,
      storeCode,
      booking.barberId,
      booking.date,
      Date.now(),
      holdId,
    ],
  });
  const [hours, minutes] = String(booking.time).split(":").map(Number);
  const startMinute = hours * 60 + minutes;
  const existingBookings = existingResult.rows.map((row) => {
    const [existingHours, existingMinutes] = String(row.time).split(":").map(Number);
    const existingStart = existingHours * 60 + existingMinutes;
    return {
      start: existingStart,
      end: existingStart + Number(row.duration),
    };
  });
  const bookingEnd = startMinute + Number(booking.duration);
  for (let minute = startMinute; minute < bookingEnd; minute += 15) {
    const overlapping = existingBookings.filter(
      (existing) => minute < existing.end && existing.start < minute + 15,
    ).length;
    if (overlapping >= capacity) return true;
  }
  return false;
}

async function validateBookingAvailability(db, booking, storeCode, bookingId = "", holdId = "") {
  const storeResult = await db.execute({
    sql: "SELECT subscription_expires_at FROM stores WHERE code = ?",
    args: [storeCode],
  });
  if (!storeResult.rows[0] || !isSubscriptionActive(storeResult.rows[0].subscription_expires_at)) {
    return "La sucursal no tiene un plan activo para aceptar reservas.";
  }
  const validDate = typeof booking.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(booking.date);
  const parsedDate = validDate ? new Date(`${booking.date}T12:00:00Z`) : null;
  const todayInArgentina = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
  if (
    !parsedDate ||
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== booking.date ||
    booking.date < todayInArgentina
  ) {
    return "La fecha del turno no es válida.";
  }
  if (typeof booking.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(booking.time))
    return "La hora del turno no es válida.";
  if (Date.parse(`${booking.date}T${booking.time}:00-03:00`) <= Date.now())
    return "Ese horario ya pasó y está fuera de horario. Elegí otro horario.";
  if (
    !Array.isArray(booking.serviceIds) ||
    booking.serviceIds.length === 0 ||
    booking.serviceIds.length > 20
  )
    return "La selección de servicios no es válida.";
  if (
    !Number.isFinite(booking.duration) ||
    booking.duration <= 0 ||
    !Number.isFinite(booking.totalPrice) ||
    booking.totalPrice < 0
  ) {
    return "El precio o la duración del turno no son válidos.";
  }

  const professionalResult = await db.execute({
    sql: "SELECT value FROM professionals WHERE id = ?",
    args: [storedRecordId(storeCode, booking.barberId)],
  });
  if (!professionalResult.rows[0]) return "El profesional elegido ya no está disponible.";
  const professional = JSON.parse(String(professionalResult.rows[0].value));
  if (professional.isTest) return "No se pueden reservar turnos de prueba.";
  const serviceIds = [...new Set(booking.serviceIds)];
  if (serviceIds.length !== booking.serviceIds.length)
    return "La selección de servicios no es válida.";
  const services = serviceIds.map((serviceId) =>
    professional.services?.find((service) => service.id === serviceId),
  );
  if (services.some((service) => !service)) return "Uno de los servicios ya no está disponible.";
  const expectedDuration = services.reduce((sum, service) => sum + Number(service.duration), 0);
  const submittedPrice = booking.totalPrice;
  const pricingPolicy = booking.pricingPolicyAtBooking ?? {
    discountCoupons: [],
    paymentPriceAdjustments: {
      efectivo: { mode: "none", percent: 0 },
      transferencia: { mode: "none", percent: 0 },
      "tarjeta o mercado pago": { mode: "none", percent: 0 },
    },
  };
  const pricing = applyBookingPricing(
    booking,
    services.map((service) => service.price),
    pricingPolicy,
  );
  if (
    pricing.error ||
    booking.duration !== expectedDuration ||
    submittedPrice !== pricing.totalPrice
  )
    return "El precio o la duración cambió. Volvé a elegir el servicio.";

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
  if (!allowedSlots.includes(booking.time))
    return "Ese horario no está dentro de la disponibilidad del profesional.";
  const [hours, minutes] = booking.time.split(":").map(Number);
  const startMinute = hours * 60 + minutes;
  if (scheduleEnd !== null && startMinute + booking.duration > scheduleEnd)
    return "El turno excede el horario del profesional.";

  const hasConflict = await hasBookingConflict(
    db,
    booking,
    storeCode,
    bookingCapacityForDate(professional, booking.date),
    bookingId,
    holdId,
  );
  return hasConflict
    ? "Ese horario acaba de ser reservado o completó sus lugares disponibles. Elegí otro horario."
    : null;
}

function validBookingSlotHoldId(value) {
  return typeof value === "string" && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
}

function slotTimeFitsDuration(slots, time, duration) {
  const allowedSlots = new Set(slots);
  const [hours, minutes] = time.split(":").map(Number);
  const start = hours * 60 + minutes;
  for (let minute = start; minute < start + duration; minute += 15) {
    const slot = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    if (!allowedSlots.has(slot)) return false;
  }
  return true;
}

async function claimBookingSlot(db, body, storeCode) {
  const holdId = body.holdId;
  if (!validBookingSlotHoldId(holdId))
    throw Object.assign(new Error("La reserva temporal del horario no es válida."), {
      statusCode: 400,
    });
  if (!storeCode)
    throw Object.assign(new Error("Seleccioná una sucursal para reservar."), { statusCode: 400 });
  const barberId = typeof body.barberId === "string" ? body.barberId.trim() : "";
  const date = typeof body.date === "string" ? body.date : "";
  const time = typeof body.time === "string" ? body.time : "";
  const serviceIds = Array.isArray(body.serviceIds) ? body.serviceIds : [];
  const duration = Number(body.duration);
  if (
    !barberId ||
    barberId.length > 200 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
    !serviceIds.length ||
    serviceIds.length > 20 ||
    serviceIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 200) ||
    new Set(serviceIds).size !== serviceIds.length ||
    !Number.isInteger(duration) ||
    duration <= 0 ||
    duration > 1440
  ) {
    throw Object.assign(new Error("Los datos del horario elegido no son válidos."), {
      statusCode: 400,
    });
  }
  const parsedDate = new Date(`${date}T12:00:00Z`);
  const todayInArgentina = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date ||
    date < todayInArgentina
  )
    throw Object.assign(new Error("La fecha del horario no es válida."), { statusCode: 400 });
  if (Date.parse(`${date}T${time}:00-03:00`) <= Date.now())
    throw Object.assign(new Error("Ese horario ya pasó. Elegí otro horario."), { statusCode: 409 });

  const transaction = await db.transaction("write");
  try {
    const now = Date.now();
    await transaction.execute({
      sql: "DELETE FROM booking_slot_holds WHERE expires_at <= ?",
      args: [now],
    });
    const eligibility = await transaction.execute({
      sql: `SELECT stores.subscription_expires_at, professionals.value AS professional_value
        FROM stores LEFT JOIN professionals ON professionals.id = ?
        WHERE stores.code = ?`,
      args: [storedRecordId(storeCode, barberId), storeCode],
    });
    if (
      !eligibility.rows[0] ||
      !isSubscriptionActive(eligibility.rows[0].subscription_expires_at)
    )
      throw Object.assign(new Error("La sucursal no tiene un plan activo para aceptar reservas."), {
        statusCode: 403,
      });
    if (!eligibility.rows[0].professional_value)
      throw Object.assign(new Error("El profesional elegido ya no está disponible."), {
        statusCode: 409,
      });
    const professional = JSON.parse(String(eligibility.rows[0].professional_value));
    if (professional.isTest)
      throw Object.assign(new Error("No se pueden reservar turnos de prueba."), {
        statusCode: 400,
      });
    const services = serviceIds.map((serviceId) =>
      professional.services?.find((service) => service.id === serviceId),
    );
    if (
      services.some((service) => !service) ||
      services.reduce((total, service) => total + Number(service.duration), 0) !== duration
    ) {
      throw Object.assign(new Error("Los servicios elegidos cambiaron. Volvé a seleccionarlos."), {
        statusCode: 409,
      });
    }

    const schedule = scheduleForDate(professional, date);
    const slots = schedule
      ? schedule.closed
        ? []
        : (scheduleSlots(schedule)?.slots ?? [])
      : (professional.availableSlots ?? []);
    if (!slotTimeFitsDuration(slots, time, duration))
      throw Object.assign(
        new Error("Ese horario ya no está disponible para los servicios elegidos."),
        { statusCode: 409 },
      );

    const booking = {
      id: holdId,
      storeCode,
      barberId,
      serviceIds,
      date,
      time,
      duration,
    };
    const capacity = bookingCapacityForDate(professional, date);
    if (await hasBookingConflict(transaction, booking, storeCode, capacity, "", holdId)) {
      throw Object.assign(
        new Error("Ese horario acaba de ser reservado. Elegí otro horario disponible."),
        { statusCode: 409 },
      );
    }

    const expiresAt = now + BOOKING_SLOT_HOLD_MS;
    await transaction.execute({
      sql: `INSERT INTO booking_slot_holds
        (hold_id, store_code, barber_id, date, time, duration, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(hold_id) DO UPDATE SET store_code = excluded.store_code,
        barber_id = excluded.barber_id, date = excluded.date, time = excluded.time,
        duration = excluded.duration, expires_at = excluded.expires_at`,
      args: [holdId, storeCode, barberId, date, time, duration, expiresAt],
    });
    await transaction.commit();
    return { holdId, expiresAt: new Date(expiresAt).toISOString() };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
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
      return response
        .status(503)
        .json({ error: error instanceof Error ? error.message : "Kinde no está configurado." });
    }
  }
  if (request.headers.authorization && !user) {
    return response
      .status(401)
      .json({ error: "La sesión no es válida o no contiene un correo verificado." });
  }
  if (request.method === "PUT" && !user) {
    return response.status(401).json({ error: "Inicia sesión para guardar tus turnos." });
  }

  let db;
  try {
    db = await database();
  } catch (error) {
    console.error("No se pudo conectar con Turso", error);
    return response
      .status(503)
      .json({ error: error instanceof Error ? error.message : "Turso no está configurado." });
  }

  if (request.method === "GET") {
    try {
      let role = "guest";
      const requestedStoreCode = normalizeStoreCode(request.headers["x-store-code"]);
      let userStoreCode = requestedStoreCode;
      let adminStoreCode = "";
      let reservationMode = false;
      if (user) {
        const storedRoleResult = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        const existingRole = storedRoleResult.rows[0]?.role;
        role =
          user.emailVerified && (existingRole === "admin" || existingRole === "client")
            ? existingRole
            : "unassigned";
        adminStoreCode =
          role === "admin" ? normalizeStoreCode(storedRoleResult.rows[0]?.store_code) : "";
        reservationMode =
          role === "admin" && Boolean(requestedStoreCode && requestedStoreCode !== adminStoreCode);
        userStoreCode =
          role === "admin" ? requestedStoreCode || adminStoreCode : requestedStoreCode;
      }
      if (userStoreCode) {
        const storeExists = await db.execute({
          sql: "SELECT code, subscription_expires_at FROM stores WHERE code = ?",
          args: [userStoreCode],
        });
        if (!storeExists.rows[0])
          return response
            .status(404)
            .json({ error: "No encontramos esa sucursal. Revisá el nombre o código." });
        if (role === "admin" && !reservationMode) await activateFreeTrial(db, userStoreCode);
        if (
          (role !== "admin" || reservationMode) &&
          !isSubscriptionActive(storeExists.rows[0].subscription_expires_at)
        ) {
          return response
            .status(404)
            .json({ error: "Esta sucursal no está disponible para reservas en este momento." });
        }
      }
      const bookingQuery = userStoreCode
        ? db.execute({
            sql: "SELECT id, value FROM bookings WHERE upper(json_extract(value, '$.storeCode')) = ? ORDER BY updated_at DESC",
            args: [userStoreCode],
          })
        : db.execute("SELECT id, value FROM bookings ORDER BY updated_at DESC");
      const professionalQuery = userStoreCode
        ? db.execute({
            sql: "SELECT id, value FROM professionals WHERE substr(id, 1, ?) = ? ORDER BY updated_at DESC",
            args: [userStoreCode.length + 1, `${userStoreCode}:`],
          })
        : db.execute("SELECT id, value FROM professionals ORDER BY updated_at DESC");
      const storesQuery = db.execute(
        `SELECT stores.code, stores.name, stores.owner_id, stores.settings, stores.logo,
          stores.subscription_expires_at, stores.subscription_plan_type,
          EXISTS(SELECT 1 FROM store_payment_credentials credentials
            WHERE credentials.store_code = stores.code
              AND credentials.public_key != ''
              AND credentials.encrypted_access_token != '') AS mercado_pago_configured
          FROM stores ORDER BY stores.name COLLATE NOCASE`,
      );
      const [bookingRows, professionalRows, storesResult] = await Promise.all([
        bookingQuery,
        professionalQuery,
        storesQuery,
      ]);
      const allBookings = bookingRows.rows.map((row) => JSON.parse(String(row.value)));
      const storeBookings = userStoreCode
        ? allBookings.filter((booking) => normalizeStoreCode(booking.storeCode) === userStoreCode)
        : [];
      const bookings =
        role === "admin" && !reservationMode
          ? storeBookings
          : storeBookings.map((booking) =>
              user && booking.customer?.email?.trim().toLowerCase() === user.email
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
                  },
            );
      const professionals = userStoreCode
        ? professionalRows.rows
            .filter((row) => String(row.id).startsWith(`${userStoreCode}:`))
            .map((row) => ({
              ...JSON.parse(String(row.value)),
              id: String(row.id).slice(userStoreCode.length + 1),
            }))
        : [];
      const stores = storesResult.rows
        .filter((row) => String(row.owner_id) !== "legacy")
        .filter(
          (row) =>
            isSubscriptionActive(row.subscription_expires_at) ||
            (role === "admin" && String(row.code) === userStoreCode),
        )
        .map((row) => ({
          code: String(row.code),
          name: String(row.name),
          settings: parseStoreSettings(row.settings),
          logo: typeof row.logo === "string" ? String(row.logo) : "",
          mercadoPagoConfigured: Boolean(row.mercado_pago_configured),
          subscriptionExpiresAt: row.subscription_expires_at
            ? String(row.subscription_expires_at)
            : null,
          subscriptionActive: isSubscriptionActive(row.subscription_expires_at),
          subscriptionPlanType: String(row.subscription_plan_type ?? ""),
        }));
      return response.status(200).json({
        data: { bookings, professionals },
        role,
        storeCode: userStoreCode || null,
        stores,
      });
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
    if (body?.action === "claim-booking-slot" || body?.action === "release-booking-slot") {
      const storeCode = normalizeStoreCode(request.headers["x-store-code"]);
      if (!storeCode)
        return response.status(400).json({ error: "Seleccioná una sucursal para reservar." });
      if (body.action === "release-booking-slot") {
        if (!validBookingSlotHoldId(body.holdId))
          return response
            .status(400)
            .json({ error: "La reserva temporal del horario no es válida." });
        try {
          await db.execute({
            sql: "DELETE FROM booking_slot_holds WHERE hold_id = ? AND store_code = ?",
            args: [body.holdId, storeCode],
          });
          return response.status(200).json({ ok: true });
        } catch (error) {
          console.error("No se pudo liberar el horario reservado temporalmente", error);
          return response.status(500).json({ error: "No se pudo liberar el horario." });
        }
      }
      try {
        const hold = await claimBookingSlot(db, body, storeCode);
        return response.status(200).json(hold);
      } catch (error) {
        const statusCode = Number(error?.statusCode);
        if (statusCode === 409 || statusCode === 400 || statusCode === 403)
          return response.status(statusCode).json({ error: error.message });
        console.error("No se pudo reservar temporalmente el horario", error);
        return response
          .status(500)
          .json({ error: "No se pudo reservar temporalmente el horario." });
      }
    }
    if (
      [
        "get-push-config",
        "get-push-subscription",
        "save-push-subscription",
        "delete-push-subscription",
      ].includes(body?.action)
    ) {
      if (!user)
        return response
          .status(401)
          .json({ error: "Iniciá sesión para activar notificaciones." });
      if (!user.emailVerified)
        return response
          .status(403)
          .json({ error: "Verificá tu correo para activar notificaciones." });
      try {
        const account = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        const role = String(account.rows[0]?.role ?? "");
        if (role !== "admin" && role !== "client")
          return response
            .status(403)
            .json({ error: "Configurá tu cuenta para activar notificaciones." });
        const recipientKey =
          role === "admin"
            ? `admin:${normalizeStoreCode(account.rows[0]?.store_code)}`
            : `client:${user.email}`;
        if (role === "admin" && recipientKey === "admin:")
          return response
            .status(403)
            .json({ error: "La cuenta administradora no tiene una sucursal asignada." });

        if (body.action === "get-push-config") {
          const configuration = webPushConfiguration();
          return response.status(200).json({
            enabled: Boolean(configuration),
            publicKey: configuration?.publicKey ?? "",
          });
        }

        if (body.action === "get-push-subscription") {
          const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
          let endpointHash = "";
          try {
            const url = new URL(endpoint);
            if (
              url.protocol !== "https:" ||
              url.username ||
              url.password ||
              endpoint.length > 4096
            )
              throw new Error("Endpoint inválido.");
            endpointHash = createHash("sha256").update(url.href, "utf8").digest("hex");
          } catch {
            return response
              .status(400)
              .json({ error: "El endpoint de notificaciones no es válido." });
          }
          const result = await db.execute({
            sql: "SELECT 1 FROM push_subscriptions WHERE endpoint_hash = ? AND recipient_key = ? LIMIT 1",
            args: [endpointHash, recipientKey],
          });
          return response.status(200).json({ subscribed: result.rows.length > 0 });
        }

        if (body.action === "save-push-subscription") {
          if (!webPushConfiguration())
            return response
              .status(503)
              .json({ error: "Las notificaciones push todavía no están configuradas." });
          const subscription = body.subscription;
          if (!validPushSubscription(subscription))
            return response
              .status(400)
              .json({ error: "La suscripción del navegador no es válida." });
          const normalizedSubscription = {
            endpoint: subscription.endpoint,
            expirationTime:
              typeof subscription.expirationTime === "number" ? subscription.expirationTime : null,
            keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
          };
          const endpointHash = createHash("sha256")
            .update(normalizedSubscription.endpoint, "utf8")
            .digest("hex");
          await db.execute({
            sql: `INSERT INTO push_subscriptions (endpoint_hash, recipient_key, subscription, updated_at)
              VALUES (?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(endpoint_hash) DO UPDATE SET recipient_key = excluded.recipient_key,
              subscription = excluded.subscription, updated_at = CURRENT_TIMESTAMP`,
            args: [endpointHash, recipientKey, JSON.stringify(normalizedSubscription)],
          });
          return response.status(200).json({ ok: true });
        }

        const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
        let endpointHash = "";
        try {
          endpointHash = createHash("sha256").update(new URL(endpoint).href, "utf8").digest("hex");
        } catch {
          return response
            .status(400)
            .json({ error: "El endpoint de notificaciones no es válido." });
        }
        await db.execute({
          sql: "DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND recipient_key = ?",
          args: [endpointHash, recipientKey],
        });
        return response.status(200).json({ ok: true });
      } catch (error) {
        console.error("No se pudo gestionar la suscripción push", error);
        return response
          .status(500)
          .json({ error: "No se pudo gestionar la suscripción de notificaciones." });
      }
    }

    if (body?.action === "validate-store-coupon") {
      try {
        const storeCode = normalizeStoreCode(request.headers["x-store-code"]);
        const code =
          typeof body.code === "string" ? body.code.trim().toLocaleUpperCase("es-AR") : "";
        if (!storeCode)
          return response.status(400).json({ error: "Elegí una sucursal antes de validar el cupón." });
        if (!/^[\p{L}\d_-]{3,32}$/u.test(code))
          return response.status(200).json({
            valid: false,
            storeCode,
            coupon: null,
            activeCoupons: [],
          });
        const storeResult = await db.execute({
          sql: "SELECT settings, subscription_expires_at FROM stores WHERE code = ?",
          args: [storeCode],
        });
        if (!storeResult.rows[0] || !isSubscriptionActive(storeResult.rows[0].subscription_expires_at))
          return response.status(404).json({ error: "La sucursal no está disponible para reservas." });
        const settings = parseStoreSettings(storeResult.rows[0].settings);
        const activeCoupons = settings.discountCoupons.filter((coupon) => coupon.active);
        const coupon = activeCoupons.find(
          (item) => item.code.toLocaleUpperCase("es-AR") === code,
        );
        return response.status(200).json({
          valid: Boolean(coupon),
          storeCode,
          coupon: coupon ?? null,
          activeCoupons,
        });
      } catch (error) {
        console.error("No se pudo validar el cupón de la sucursal", error);
        return response.status(500).json({ error: "No se pudo validar el cupón." });
      }
    }
    if (user && body?.action === "permanently-delete-archived-bookings") {
      try {
        const result = await permanentlyDeleteArchivedBookings(db, user, body.bookingIds);
        return response.status(result.status).json(result.body);
      } catch (error) {
        console.error("No se pudieron borrar los turnos archivados", error);
        return response
          .status(500)
          .json({ error: "No se pudieron borrar los turnos seleccionados." });
      }
    }
    if (user && body?.action === "admin-update-booking") {
      try {
        const result = await updateAdminBooking(db, user, body);
        return response.status(result.status).json(result.body);
      } catch (error) {
        console.error("No se pudo actualizar el turno", error);
        return response.status(500).json({ error: "No se pudo actualizar el turno." });
      }
    }
    if (user && body?.action === "archive-bookings") {
      try {
        const result = await archiveBookings(db, user, body.bookingIds);
        return response.status(result.status).json(result.body);
      } catch (error) {
        console.error("No se pudieron archivar los turnos", error);
        return response
          .status(500)
          .json({ error: "No se pudieron archivar los turnos seleccionados." });
      }
    }
    if (user && body?.action === "restore-archived-bookings") {
      try {
        const result = await restoreArchivedBookings(db, user, body.bookingIds);
        return response.status(result.status).json(result.body);
      } catch (error) {
        console.error("No se pudieron restaurar los turnos archivados", error);
        return response
          .status(500)
          .json({ error: "No se pudieron restaurar los turnos seleccionados." });
      }
    }
    if (user && body?.action === "archive-booking") {
      try {
        if (!user.emailVerified)
          return response
            .status(403)
            .json({ error: "Verificá tu correo antes de archivar turnos." });
        const account = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        const role = String(account.rows[0]?.role ?? "");
        if (role !== "admin" && role !== "client")
          return response.status(403).json({ error: "Configurá tu cuenta para archivar turnos." });
        const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : "";
        if (!bookingId || bookingId.length > 200)
          return response.status(400).json({ error: "Identificador de turno inválido." });
        const existing = await db.execute({
          sql: "SELECT value FROM bookings WHERE id = ?",
          args: [bookingId],
        });
        if (!existing.rows[0])
          return response.status(404).json({ error: "No encontramos ese turno." });
        const previousValue = String(existing.rows[0].value);
        const booking = JSON.parse(previousValue);
        const storeCode = normalizeStoreCode(booking.storeCode);
        if (role === "client") {
          if (booking.customer?.email?.trim().toLowerCase() !== user.email)
            return response.status(403).json({ error: "Solo puedes archivar tus propios turnos." });
        } else if (storeCode !== normalizeStoreCode(account.rows[0]?.store_code)) {
          return response.status(403).json({ error: "El turno no corresponde a tu sucursal." });
        }
        if (!canArchiveBooking(booking)) {
          const pendingRefund = hasPendingRefund(booking);
          const pendingPayment =
            booking.paymentStatus === "pending" ||
            booking.status === "pending-payment" ||
            (Boolean(booking.paymentReportedAt) && booking.paymentStatus !== "approved");
          return response.status(409).json({
            error: pendingRefund
              ? "No se puede borrar el turno mientras la devolución solicitada esté pendiente."
              : pendingPayment
                ? "No se puede borrar el turno mientras haya un pago pendiente de confirmación."
                : "Solo se puede borrar un turno pagado, asistido, cancelado o con la devolución realizada.",
          });
        }
        const archiveField = role === "client" ? "clientArchivedAt" : "adminArchivedAt";
        if (!booking[archiveField]) {
          booking[archiveField] = new Date().toISOString();
          delete booking[role === "client" ? "clientRestoredAt" : "adminRestoredAt"];
          await persistBookingUpdate(db, bookingId, previousValue, booking);
        }
        return response.status(200).json({ booking });
      } catch (error) {
        console.error("No se pudo archivar el turno", error);
        return response
          .status(Number.isInteger(error?.statusCode) ? error.statusCode : 500)
          .json({ error: error instanceof Error ? error.message : "No se pudo archivar el turno." });
      }
    }
    if (user && body?.action === "restore-archived-booking") {
      try {
        if (!user.emailVerified)
          return response
            .status(403)
            .json({ error: "Verificá tu correo antes de restaurar turnos." });
        const account = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        const role = String(account.rows[0]?.role ?? "");
        if (role !== "admin" && role !== "client")
          return response.status(403).json({ error: "Configurá tu cuenta para restaurar turnos." });
        const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : "";
        if (!bookingId || bookingId.length > 200)
          return response.status(400).json({ error: "Identificador de turno inválido." });
        const existing = await db.execute({
          sql: "SELECT value FROM bookings WHERE id = ?",
          args: [bookingId],
        });
        if (!existing.rows[0])
          return response.status(404).json({ error: "No encontramos ese turno." });
        const previousValue = String(existing.rows[0].value);
        const booking = JSON.parse(previousValue);
        if (role === "client") {
          if (booking.customer?.email?.trim().toLowerCase() !== user.email)
            return response
              .status(403)
              .json({ error: "Solo puedes restaurar tus propios turnos." });
        } else if (
          normalizeStoreCode(booking.storeCode) !== normalizeStoreCode(account.rows[0]?.store_code)
        ) {
          return response.status(403).json({ error: "El turno no corresponde a tu sucursal." });
        }
        const archiveField = role === "client" ? "clientArchivedAt" : "adminArchivedAt";
        const restoredField = role === "client" ? "clientRestoredAt" : "adminRestoredAt";
        const appointmentAt = Date.parse(`${booking.date}T${booking.time}:00-03:00`);
        const isAutomaticallyArchived =
          !booking[restoredField] &&
          (booking.status === "completed" ||
            booking.status === "no-show" ||
            (Number.isFinite(appointmentAt) && Date.now() >= appointmentAt + 24 * 60 * 60 * 1000));
        if (!booking[archiveField] && !isAutomaticallyArchived)
          return response.status(409).json({ error: "Este turno no está eliminado de tu lista." });
        delete booking[archiveField];
        booking[restoredField] = new Date().toISOString();
        await persistBookingUpdate(db, bookingId, previousValue, booking);
        return response.status(200).json({ booking });
      } catch (error) {
        console.error("No se pudo restaurar el turno", error);
        return response
          .status(Number.isInteger(error?.statusCode) ? error.statusCode : 500)
          .json({ error: error instanceof Error ? error.message : "No se pudo restaurar el turno." });
      }
    }
    if (user && body?.action === "permanently-delete-archived-booking") {
      try {
        if (!user.emailVerified)
          return response.status(403).json({ error: "Verificá tu correo antes de borrar turnos." });
        const account = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        const role = String(account.rows[0]?.role ?? "");
        if (role !== "admin" && role !== "client")
          return response.status(403).json({ error: "Configurá tu cuenta para borrar turnos." });
        const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : "";
        if (!bookingId || bookingId.length > 200)
          return response.status(400).json({ error: "Identificador de turno inválido." });
        const existing = await db.execute({
          sql: "SELECT value FROM bookings WHERE id = ?",
          args: [bookingId],
        });
        if (!existing.rows[0])
          return response.status(404).json({ error: "No encontramos ese turno." });
        const previousValue = String(existing.rows[0].value);
        const booking = JSON.parse(previousValue);
        if (role === "client") {
          if (booking.customer?.email?.trim().toLowerCase() !== user.email)
            return response
              .status(403)
              .json({ error: "Solo puedes borrar definitivamente tus propios turnos." });
        } else if (
          normalizeStoreCode(booking.storeCode) !== normalizeStoreCode(account.rows[0]?.store_code)
        ) {
          return response.status(403).json({ error: "El turno no corresponde a tu sucursal." });
        }
        const archiveField = role === "client" ? "clientArchivedAt" : "adminArchivedAt";
        const restoredField = role === "client" ? "clientRestoredAt" : "adminRestoredAt";
        const appointmentAt = Date.parse(`${booking.date}T${booking.time}:00-03:00`);
        const isAutomaticallyArchived =
          !booking[restoredField] &&
          (booking.status === "completed" ||
            booking.status === "no-show" ||
            (Number.isFinite(appointmentAt) && Date.now() >= appointmentAt + 24 * 60 * 60 * 1000));
        if (!booking[archiveField] && !isAutomaticallyArchived) {
          return response
            .status(409)
            .json({ error: "Primero archivá el turno desde la lista principal." });
        }
        if (!canDeleteBooking(booking)) {
          const pendingRefund = hasPendingRefund(booking);
          const pendingPayment =
            booking.paymentStatus === "pending" ||
            booking.status === "pending-payment" ||
            (Boolean(booking.paymentReportedAt) && booking.paymentStatus !== "approved");
          return response.status(409).json({
            error: pendingRefund
              ? "No se puede borrar definitivamente mientras la devolución esté pendiente."
              : pendingPayment
                ? "No se puede borrar definitivamente mientras haya un pago pendiente de confirmación."
                : "Solo se puede borrar un turno pagado, asistido, cancelado o con la devolución realizada.",
          });
        }
        booking[role === "client" ? "clientPermanentlyDeletedAt" : "adminPermanentlyDeletedAt"] =
          new Date().toISOString();
        await persistBookingUpdate(db, bookingId, previousValue, booking);
        return response.status(200).json({ ok: true, booking });
      } catch (error) {
        console.error("No se pudo borrar definitivamente el turno", error);
        return response
          .status(Number.isInteger(error?.statusCode) ? error.statusCode : 500)
          .json({
            error:
              error instanceof Error
                ? error.message
                : "No se pudo borrar definitivamente el turno.",
          });
      }
    }
    if (
      user &&
      [
        "get-notifications",
        "check-notification-booking",
        "set-notification-read",
        "delete-notification",
        "delete-all-notifications",
      ].includes(body?.action)
    ) {
      try {
        if (!user.emailVerified)
          return response
            .status(403)
            .json({ error: "Verificá tu correo para consultar tus notificaciones." });
        const account = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        const role = String(account.rows[0]?.role ?? "");
        if (role !== "admin" && role !== "client")
          return response
            .status(403)
            .json({ error: "Configurá tu cuenta para consultar notificaciones." });
        const recipientKey =
          role === "admin"
            ? `admin:${normalizeStoreCode(account.rows[0]?.store_code)}`
            : `client:${user.email}`;
        if (role === "admin" && recipientKey === "admin:")
          return response
            .status(403)
            .json({ error: "La cuenta administradora no tiene una sucursal asignada." });

        if (body.action === "get-notifications") {
          const result = await db.execute({
            sql: `SELECT notifications.id, notifications.booking_id AS bookingId, notifications.type, notifications.title,
              notifications.message, notifications.created_at AS createdAt, notifications.read_at AS readAt,
              notifications.prompted_at AS promptedAt,
              (SELECT bookings.value FROM bookings WHERE bookings.id = notifications.booking_id
                AND upper(json_extract(bookings.value, '$.storeCode')) = upper(notifications.store_code) LIMIT 1) AS bookingValue
              FROM notifications WHERE notifications.recipient_key = ? ORDER BY notifications.created_at DESC LIMIT 100`,
            args: [recipientKey],
          });
          const notifications = result.rows.map((row) => ({
            id: String(row.id),
            bookingId: String(row.bookingId),
            type: String(row.type),
            title: String(row.title),
            message: String(row.message),
            createdAt: String(row.createdAt),
            readAt: row.readAt ? String(row.readAt) : null,
            bookingExists:
              Boolean(row.bookingValue) &&
              (() => {
                const booking = JSON.parse(String(row.bookingValue));
                return (
                  isBookingVisibleInMainList(booking, role) ||
                  isBookingVisibleInArchiveList(booking, role)
                );
              })(),
          }));
          const newForPrompt = notifications.filter((notification) => {
            const row = result.rows.find((item) => String(item.id) === notification.id);
            return !row?.promptedAt;
          });
          if (newForPrompt.length) {
            await db.batch(
              newForPrompt.map(({ id }) => ({
                sql: "UPDATE notifications SET prompted_at = CURRENT_TIMESTAMP WHERE id = ? AND recipient_key = ? AND prompted_at IS NULL",
                args: [id, recipientKey],
              })),
              "write",
            );
          }
          return response.status(200).json({ notifications, newForPrompt });
        }

        if (body.action === "delete-all-notifications") {
          await db.execute({
            sql: "DELETE FROM notifications WHERE recipient_key = ?",
            args: [recipientKey],
          });
          return response.status(200).json({ ok: true });
        }

        const notificationId = typeof body.notificationId === "string" ? body.notificationId : "";
        if (
          !notificationId ||
          notificationId.length > 100 ||
          (body.action === "set-notification-read" && typeof body.read !== "boolean")
        ) {
          return response.status(400).json({ error: "La notificación seleccionada no es válida." });
        }
        if (body.action === "check-notification-booking") {
          const notice = await db.execute({
            sql: "SELECT booking_id, store_code FROM notifications WHERE id = ? AND recipient_key = ?",
            args: [notificationId, recipientKey],
          });
          if (!notice.rows[0])
            return response.status(404).json({ error: "No encontramos esa notificación." });
          const booking = await db.execute({
            sql: "SELECT value FROM bookings WHERE id = ?",
            args: [String(notice.rows[0].booking_id)],
          });
          const bookingValue = booking.rows[0] ? JSON.parse(String(booking.rows[0].value)) : null;
          const exists =
            Boolean(bookingValue) &&
            normalizeStoreCode(bookingValue.storeCode) ===
              normalizeStoreCode(notice.rows[0].store_code) &&
            (isBookingVisibleInMainList(bookingValue, role) ||
              isBookingVisibleInArchiveList(bookingValue, role));
          return response.status(200).json({ exists });
        }
        if (body.action === "delete-notification") {
          const deleted = await db.execute({
            sql: "DELETE FROM notifications WHERE id = ? AND recipient_key = ?",
            args: [notificationId, recipientKey],
          });
          return response.status(200).json({ ok: true, deleted: deleted.rowsAffected > 0 });
        }
        const updated = await db.execute({
          sql: "UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_key = ?",
          args: [body.read ? new Date().toISOString() : null, notificationId, recipientKey],
        });
        if (!updated.rowsAffected)
          return response.status(404).json({ error: "No encontramos esa notificación." });
        return response.status(200).json({ ok: true });
      } catch (error) {
        console.error("No se pudieron gestionar las notificaciones", error);
        return response
          .status(500)
          .json({ error: "No se pudieron cargar o actualizar las notificaciones." });
      }
    }
    if (
      user &&
      [
        "get-client-bookings",
        "confirm-client-booking",
        "report-client-payment",
        "update-client-booking",
        "cancel-client-booking",
        "delete-client-booking",
        "cancel-client-payment",
        "update-client-payment-method",
        "create-client-booking-payment-preference",
      ].includes(body?.action)
    ) {
      try {
        if (!user.emailVerified)
          return response
            .status(403)
            .json({ error: "Verificá tu correo para consultar tus turnos." });
        const roleResult = await db.execute({
          sql: "SELECT role FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        if (roleResult.rows[0]?.role !== "client")
          return response
            .status(403)
            .json({ error: "Esta acción es solo para cuentas de cliente." });

        if (body.action === "get-client-bookings") {
          const bookingRows = await db.execute({
            sql: "SELECT id, value FROM bookings WHERE lower(trim(json_extract(value, '$.customer.email'))) = ? ORDER BY updated_at DESC",
            args: [user.email],
          });
          const bookings = bookingRows.rows.map((row) => JSON.parse(String(row.value)));
          const storeCodes = [
            ...new Set(
              bookings.map((booking) => normalizeStoreCode(booking.storeCode)).filter(Boolean),
            ),
          ];
          const [occupiedResults, professionalResults, storeRows] = await Promise.all([
            Promise.all(
              storeCodes.map((code) =>
                db.execute({
                  sql: "SELECT id, value FROM bookings WHERE upper(json_extract(value, '$.storeCode')) = ? AND json_extract(value, '$.status') <> 'cancelled'",
                  args: [code],
                }),
              ),
            ),
            Promise.all(
              storeCodes.map((code) =>
                db.execute({
                  sql: "SELECT id, value FROM professionals WHERE id >= ? AND id < ? ORDER BY updated_at DESC",
                  args: [`${code}:`, `${code};`],
                }),
              ),
            ),
            storeCodes.length
              ? db.execute({
                  sql: `SELECT code, name, settings FROM stores WHERE code IN (${storeCodes.map(() => "?").join(",")}) ORDER BY name`,
                  args: storeCodes,
                })
              : Promise.resolve({ rows: [] }),
          ]);
          const occupiedSlots = occupiedResults.flatMap((result) =>
            result.rows.map((row) => {
              const booking = JSON.parse(String(row.value));
              return {
                id: String(row.id),
                storeCode: booking.storeCode,
                barberId: booking.barberId,
                date: booking.date,
                time: booking.time,
                duration: booking.duration,
                status: booking.status,
              };
            }),
          );
          const professionals = professionalResults.flatMap((result, index) => {
            const code = storeCodes[index];
            const prefix = `${code}:`;
            return result.rows.map((row) => ({
              ...JSON.parse(String(row.value)),
              id: String(row.id).slice(prefix.length),
              storeCode: code,
            }));
          });
          const stores = storeRows.rows.map((row) => ({
            code: String(row.code),
            name: String(row.name),
            settings: parseStoreSettings(row.settings),
          }));
          return response.status(200).json({ bookings, professionals, occupiedSlots, stores });
        }

        const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : "";
        if (!bookingId || bookingId.length > 200)
          return response.status(400).json({ error: "Identificador de turno inválido." });
        const storedBooking = await db.execute({
          sql: "SELECT value FROM bookings WHERE id = ?",
          args: [bookingId],
        });
        if (!storedBooking.rows[0])
          return response.status(404).json({ error: "No encontramos ese turno." });
        const previousBookingValue = String(storedBooking.rows[0].value);
        const booking = JSON.parse(previousBookingValue);
        if (booking.customer?.email?.trim().toLowerCase() !== user.email) {
          return response.status(403).json({ error: "Solo puedes gestionar tus propios turnos." });
        }

        if (body.action === "confirm-client-booking") {
          if (booking.status !== "confirmed")
            return response
              .status(400)
              .json({ error: "Este turno todavía no se puede confirmar." });
          booking.appointmentConfirmation = "confirmed";
          const notice = notificationForAdmin(
            booking,
            "booking_confirmed_by_client",
            "Cliente confirmó el turno",
            `${booking.customer.fullName} confirmó su asistencia al turno.`,
          );
          await persistBookingUpdate(db, bookingId, previousBookingValue, booking, notice);
          return response.status(200).json({ booking });
        }

        if (body.action === "report-client-payment") {
          if (
            !["confirmed", "pending-payment"].includes(booking.status) ||
            booking.paymentStatus === "approved" ||
            booking.paymentReportedAt ||
            booking.paymentCancellationStatus
          ) {
            return response
              .status(409)
              .json({ error: "Este turno no está pendiente de informar un pago." });
          }
          booking.paymentReportedAt = new Date().toISOString();
          const notice = notificationForAdmin(
            booking,
            "payment_reported",
            "Pago informado por el cliente",
            `${booking.customer.fullName} avisó que realizó el pago.`,
          );
          await persistBookingUpdate(db, bookingId, previousBookingValue, booking, notice);
          return response.status(200).json({ booking });
        }

        if (body.action === "cancel-client-payment") {
          const cancelledByProfessional =
            booking.status === "cancelled" && booking.cancelledBy === "professional";
          if (
            !cancelledByProfessional &&
            !["confirmed", "pending-payment"].includes(booking.status)
          ) {
            return response.status(409).json({ error: "Este turno ya no está activo." });
          }
          if (booking.paymentStatus !== "approved") {
            return response.status(409).json({
              error:
                "Solo podés solicitar una devolución después de que el profesional confirme el pago.",
            });
          }
          if (booking.paymentCancellationStatus) {
            return response
              .status(409)
              .json({ error: "Ya existe una solicitud de devolución para este pago." });
          }
          const policy =
            validateCancellationPolicy(booking.cancellationPolicyAtBooking) ??
            (await getStoreCancellationPolicy(db, booking.storeCode));
          if (!cancelledByProfessional && (policy.noRefunds || !policy.allowRefunds)) {
            return response.status(403).json({
              error: "La política de esta sucursal no permite cancelar ni devolver pagos.",
            });
          }
          const refundPercent = cancelledByProfessional ? 100 : policy.refundPercent;
          const refundAmount = Math.round((Number(booking.totalPrice) * refundPercent) / 100);
          if (refundAmount <= 0) {
            return response.status(403).json({
              error: "La política de esta sucursal no permite devolver dinero por este pago.",
            });
          }
          const appointmentAt =
            /^\d{4}-\d{2}-\d{2}$/.test(booking.date) &&
            /^([01]\d|2[0-3]):[0-5]\d$/.test(booking.time)
              ? Date.parse(`${booking.date}T${booking.time}:00-03:00`)
              : Number.NaN;
          if (
            !cancelledByProfessional &&
            (!Number.isFinite(appointmentAt) ||
              appointmentAt - Date.now() < policy.cancellationWindowMinutes * 60 * 1000)
          ) {
            return response.status(409).json({
              error: `Solo podés solicitar la cancelación con al menos ${policy.cancellationWindowMinutes} minutos de anticipación.`,
            });
          }
          const paymentMethod = booking.customer?.paymentMethod;
          if (!["efectivo", "transferencia", "tarjeta o mercado pago"].includes(paymentMethod)) {
            return response
              .status(409)
              .json({ error: "No se puede solicitar la devolución para este método de pago." });
          }
          let refundDestination = "";
          let refundDestinationType = "";
          refundDestinationType =
            body.refundDestinationType === "cbu"
              ? "cbu"
              : body.refundDestinationType === "alias"
                ? "alias"
                : "";
          refundDestination =
            typeof body.refundDestination === "string" ? body.refundDestination.trim() : "";
          if (refundDestinationType === "cbu") {
            refundDestination = refundDestination.replace(/\s/g, "");
            if (!/^\d{22}$/.test(refundDestination))
              return response.status(400).json({ error: "Ingresá un CBU válido de 22 dígitos." });
          } else if (refundDestinationType === "alias") {
            if (!/^[\p{L}\d._-]{6,30}$/u.test(refundDestination))
              return response
                .status(400)
                .json({ error: "Ingresá un alias válido de 6 a 30 caracteres." });
          } else {
            return response
              .status(400)
              .json({ error: "Indicá si el dato para recibir la devolución es CBU o alias." });
          }
          booking.refundDestination = refundDestination;
          booking.refundDestinationType = refundDestinationType;
          if (refundDestinationType === "cbu") booking.refundCbu = refundDestination;
          else delete booking.refundCbu;
          booking.paymentCancellationStatus = "requested";
          booking.refundAmount = refundAmount;
          if (!cancelledByProfessional) booking.clientCancellationRefundEligible = true;
          booking.refundRequestedAt = new Date().toISOString();
          booking.paymentCancellationRequestedAt = booking.refundRequestedAt;
          booking.status = "cancelled";
          booking.cancelledBy = cancelledByProfessional ? "professional" : "client";
          const destinationMessage = refundDestination
            ? ` ${refundDestinationType.toUpperCase()}: ${refundDestination}.`
            : "";
          const notice = notificationForAdmin(
            booking,
            "payment_refund_requested",
            "Devolución solicitada",
            `${booking.customer.fullName} solicita devolver $${refundAmount.toLocaleString("es-AR")} (${refundPercent}% del pago). Método: ${paymentMethod}.${destinationMessage}`,
          );
          await persistBookingUpdate(db, bookingId, previousBookingValue, booking, notice);
          return response.status(200).json({ booking, cancellationStatus: "requested" });
        }

        if (body.action === "update-client-payment-method") {
          const paymentMethod = body.paymentMethod;
          if (
            booking.paymentStatus === "approved" ||
            booking.paymentReportedAt ||
            booking.paymentCancellationStatus ||
            !["confirmed", "pending-payment"].includes(booking.status)
          ) {
            return response.status(409).json({
              error:
                "No se puede cambiar el método porque el pago ya fue confirmado o el turno ya no está activo.",
            });
          }
          if (!["efectivo", "transferencia", "tarjeta o mercado pago"].includes(paymentMethod)) {
            return response.status(400).json({ error: "Método de pago inválido." });
          }
          const previousMethod = booking.customer.paymentMethod;
          const professionalResult = await db.execute({
            sql: "SELECT value FROM professionals WHERE id = ?",
            args: [storedRecordId(booking.storeCode, booking.barberId)],
          });
          if (!professionalResult.rows[0])
            return response.status(409).json({ error: "No encontramos los servicios del turno." });
          const professional = JSON.parse(String(professionalResult.rows[0].value));
          const services = booking.serviceIds.map((serviceId) =>
            professional.services?.find((service) => service.id === serviceId),
          );
          if (services.some((service) => !service))
            return response.status(409).json({ error: "Uno de los servicios ya no está disponible." });
          const candidate = {
            ...booking,
            customer: { ...booking.customer, paymentMethod },
          };
          const pricing = applyBookingPricing(
            candidate,
            services.map((service) => service.price),
            booking.pricingPolicyAtBooking ?? { discountCoupons: [], paymentPriceAdjustments: {} },
          );
          if (pricing.error) return response.status(409).json({ error: pricing.error });
          Object.assign(booking, candidate);
          booking.status = "confirmed";
          booking.paymentStatus = "pending";
          delete booking.paymentReportedAt;
          const notice =
            previousMethod !== paymentMethod
              ? notificationForAdmin(
                  booking,
                  "payment_method_changed",
                  "Método de pago cambiado",
                  `${booking.customer.fullName} cambió el método de pago a ${paymentMethod}.`,
                )
              : null;
          await persistBookingUpdate(db, bookingId, previousBookingValue, booking, notice);
          return response.status(200).json({ booking });
        }

        if (body.action === "create-client-booking-payment-preference") {
          if (
            booking.paymentStatus === "approved" ||
            booking.paymentReportedAt ||
            booking.paymentCancellationStatus ||
            !["confirmed", "pending-payment"].includes(booking.status) ||
            booking.customer?.paymentMethod !== "tarjeta o mercado pago"
          ) {
            return response
              .status(409)
              .json({ error: "El turno no está pendiente de pago con Mercado Pago." });
          }
          const credentials = await getStorePaymentCredentials(db, booking.storeCode);
          const host = request.headers.host || "localhost";
          const protocol = request.headers["x-forwarded-proto"] || "https";
          const appUrl = (process.env.PUBLIC_APP_URL || `${protocol}://${host}`).replace(/\/$/, "");
          const preferenceResponse = await fetch(
            "https://api.mercadopago.com/checkout/preferences",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${credentials.accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                items: [
                  {
                    id: `booking-${bookingId}`,
                    title: "Reserva de turno",
                    quantity: 1,
                    currency_id: "ARS",
                    unit_price: Number(Number(booking.totalPrice).toFixed(2)),
                  },
                ],
                payer: { email: booking.customer.email },
                external_reference: bookingId,
                notification_url: `${appUrl}/api/mercadopago/webhook?booking_id=${encodeURIComponent(bookingId)}`,
                metadata: {
                  booking_id: bookingId,
                  store_code: normalizeStoreCode(booking.storeCode),
                },
                back_urls: {
                  success: `${appUrl}/mis-turnos?payment=success`,
                  failure: `${appUrl}/mis-turnos?payment=failure`,
                  pending: `${appUrl}/mis-turnos?payment=pending`,
                },
                auto_return: "approved",
              }),
            },
          );
          const preference = await preferenceResponse.json();
          if (!preferenceResponse.ok || !preference.init_point)
            return response.status(502).json({ error: "Mercado Pago no pudo preparar el pago." });
          return response.status(200).json({ initPoint: preference.init_point });
        }

        if (body.action === "update-client-booking") {
          if (
            booking.paymentStatus === "approved" ||
            booking.paymentReportedAt ||
            booking.paymentCancellationStatus
          ) {
            return response.status(409).json({
              error:
                "No se puede modificar el turno porque el pago ya fue informado, confirmado o está en proceso de devolución.",
            });
          }
          if (!["confirmed", "pending-payment"].includes(booking.status)) {
            return response
              .status(409)
              .json({ error: "Este turno ya no se puede modificar desde tu cuenta." });
          }
          const barberId = typeof body.barberId === "string" ? body.barberId.trim() : "";
          const serviceIds = Array.isArray(body.serviceIds)
            ? body.serviceIds.map((serviceId) =>
                typeof serviceId === "string" ? serviceId.trim() : "",
              )
            : [];
          const date = typeof body.date === "string" ? body.date : "";
          const time = typeof body.time === "string" ? body.time : "";
          if (
            !barberId ||
            barberId.length > 200 ||
            serviceIds.length === 0 ||
            serviceIds.length > 20 ||
            serviceIds.some((serviceId) => !serviceId || serviceId.length > 200) ||
            new Set(serviceIds).size !== serviceIds.length
          ) {
            return response
              .status(400)
              .json({ error: "Elegí un profesional y un servicio válidos." });
          }
          const transaction = await db.transaction("write");
          try {
            const professionalResult = await transaction.execute({
              sql: "SELECT value FROM professionals WHERE id = ?",
              args: [storedRecordId(normalizeStoreCode(booking.storeCode), barberId)],
            });
            if (!professionalResult.rows[0]) {
              await transaction.rollback();
              return response
                .status(409)
                .json({ error: "El profesional elegido ya no está disponible." });
            }
            const professional = JSON.parse(String(professionalResult.rows[0].value));
            const services = serviceIds.map((serviceId) =>
              professional.services?.find((item) => item.id === serviceId),
            );
            if (services.some((service) => !service)) {
              await transaction.rollback();
              return response
                .status(409)
                .json({ error: "Uno de los servicios elegidos ya no está disponible." });
            }
            const duration = services.reduce(
              (total, service) => total + Number(service.duration),
              0,
            );
            const candidate = {
              ...booking,
              barberId,
              serviceIds,
              duration,
              date,
              time,
            };
            const pricing = applyBookingPricing(
              candidate,
              services.map((service) => service.price),
              booking.pricingPolicyAtBooking ?? { discountCoupons: [], paymentPriceAdjustments: {} },
            );
            if (pricing.error) {
              await transaction.rollback();
              return response.status(409).json({ error: pricing.error });
            }
            const availabilityError = await validateBookingAvailability(
              transaction,
              candidate,
              normalizeStoreCode(booking.storeCode),
              bookingId,
            );
            if (availabilityError) {
              await transaction.rollback();
              return response.status(409).json({ error: availabilityError });
            }
            booking.barberId = barberId;
            booking.serviceIds = serviceIds;
            booking.duration = candidate.duration;
            booking.totalPrice = candidate.totalPrice;
            booking.date = date;
            booking.time = time;
            const update = await transaction.execute({
              sql: "UPDATE bookings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND value = ?",
              args: [JSON.stringify(booking), bookingId, previousBookingValue],
            });
            if (!update.rowsAffected) {
              await transaction.rollback();
              return response.status(409).json({
                error: "El turno cambió en otra operación. Actualizá e intentá de nuevo.",
              });
            }
            const serviceNames = services.map((service) => service.name).join(", ");
            const notice = notificationForAdmin(
              booking,
              "booking_changed_by_client",
              "Cliente modificó el turno",
              `${booking.customer.fullName} modificó el turno: ${professional.name}, ${serviceNames}, ${date} a las ${time}.`,
            );
            if (notice) await persistNotification(transaction, notice);
            await transaction.commit();
            if (notice) await sendPushForNotification(db, notice);
            return response.status(200).json({ booking });
          } catch (error) {
            await transaction.rollback().catch(() => undefined);
            throw error;
          }
        }

        const method = booking.customer?.paymentMethod;
        const canCancel =
          !booking.paymentCancellationStatus &&
          ["efectivo", "transferencia", "tarjeta o mercado pago"].includes(method);
        if (!canCancel || !["confirmed", "pending-payment"].includes(booking.status)) {
          return response.status(403).json({
            error: "Este turno no se puede cancelar porque el método de pago no lo permite.",
          });
        }
        const appointmentAt = Date.parse(`${booking.date}T${booking.time}:00-03:00`);
        if (!Number.isFinite(appointmentAt) || appointmentAt <= Date.now()) {
          return response.status(409).json({
            error: "No se puede cancelar un turno que ya comenzó o cuya fecha no es válida.",
          });
        }
        let clientCancellationRefundEligible = false;
        if (booking.paymentStatus === "approved") {
          const policy =
            validateCancellationPolicy(booking.cancellationPolicyAtBooking) ??
            (await getStoreCancellationPolicy(db, booking.storeCode));
          clientCancellationRefundEligible =
            !policy.noRefunds &&
            policy.allowRefunds &&
            policy.refundPercent > 0 &&
            appointmentAt - Date.now() >= policy.cancellationWindowMinutes * 60 * 1000;
          if (clientCancellationRefundEligible) {
            return response.status(409).json({
              error:
                "Este turno permite solicitar una devolución. Iniciá la solicitud antes de cancelar.",
            });
          }
        }
        booking.status = "cancelled";
        booking.cancelledBy = "client";
        booking.clientCancellationRefundEligible = clientCancellationRefundEligible;
        delete booking.cancellationToken;
        const notice = notificationForAdmin(
          booking,
          "booking_cancelled_by_client",
          "Turno cancelado por el cliente",
          `${booking.customer.fullName} canceló su turno. El horario quedó disponible.${booking.paymentStatus === "approved" ? " No se inició una solicitud de devolución." : ""}`,
        );
        await persistBookingUpdate(db, bookingId, previousBookingValue, booking, notice);
        return response.status(200).json({ booking });
      } catch (error) {
        console.error("No se pudieron gestionar los turnos del cliente", error);
        return response
          .status(Number.isInteger(error?.statusCode) ? error.statusCode : 500)
          .json({
            error:
              error instanceof Error ? error.message : "No se pudieron gestionar tus turnos.",
          });
      }
    }
    if (user && body?.action === "admin-confirm-booking-refund") {
      try {
        if (!user.emailVerified)
          return response
            .status(403)
            .json({ error: "Verificá tu correo antes de confirmar devoluciones." });
        const account = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        if (account.rows[0]?.role !== "admin")
          return response
            .status(403)
            .json({ error: "Solo un profesional puede confirmar la devolución." });
        const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : "";
        if (!bookingId || bookingId.length > 200)
          return response.status(400).json({ error: "Identificador de turno inválido." });
        const stored = await db.execute({
          sql: "SELECT value FROM bookings WHERE id = ?",
          args: [bookingId],
        });
        if (!stored.rows[0])
          return response.status(404).json({ error: "No encontramos ese turno." });
        const previousBookingValue = String(stored.rows[0].value);
        const booking = JSON.parse(previousBookingValue);
        if (
          normalizeStoreCode(booking.storeCode) !== normalizeStoreCode(account.rows[0]?.store_code)
        ) {
          return response.status(403).json({ error: "El turno no corresponde a tu sucursal." });
        }
        if (
          booking.paymentCancellationStatus !== "requested" ||
          booking.paymentStatus !== "approved" ||
          booking.status !== "cancelled"
        ) {
          return response
            .status(409)
            .json({ error: "No hay una solicitud de devolución confirmada pendiente." });
        }
        booking.paymentCancellationStatus = "refunded";
        booking.refundConfirmedAt = new Date().toISOString();
        const notice = notificationForClient(
          booking,
          "payment_refunded",
          "Devolución realizada",
          `El profesional confirmó la devolución de $${Number(booking.refundAmount ?? booking.totalPrice).toLocaleString("es-AR")}.`,
        );
        await persistBookingUpdate(db, bookingId, previousBookingValue, booking, notice);
        return response.status(200).json({ booking });
      } catch (error) {
        console.error("No se pudo confirmar la devolución del turno", error);
        return response
          .status(Number.isInteger(error?.statusCode) ? error.statusCode : 500)
          .json({
            error: error instanceof Error ? error.message : "No se pudo confirmar la devolución.",
          });
      }
    }
    if (user && (body?.action === "get-client-profile" || body?.action === "save-client-profile")) {
      try {
        if (!user.emailVerified)
          return response
            .status(403)
            .json({ error: "Verificá tu correo para acceder a tus datos." });
        const roleResult = await db.execute({
          sql: "SELECT role FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        if (roleResult.rows[0]?.role !== "client")
          return response
            .status(403)
            .json({ error: "Esta sección es solo para cuentas de cliente." });

        if (body.action === "get-client-profile") {
          const profile = await db.execute({
            sql: "SELECT phone FROM client_profiles WHERE user_id = ?",
            args: [user.id],
          });
          return response.status(200).json({ phone: String(profile.rows[0]?.phone ?? "") });
        }

        const phone = typeof body.phone === "string" ? body.phone.trim() : "";
        if (phone && (phone.length < 6 || phone.length > 40)) {
          return response
            .status(400)
            .json({ error: "El teléfono debe tener entre 6 y 40 caracteres." });
        }
        await withWriteTransaction(db, async (transaction) => {
          const currentRole = await transaction.execute({
            sql: "SELECT role FROM account_roles WHERE user_id = ?",
            args: [user.id],
          });
          if (currentRole.rows[0]?.role !== "client")
            throw Object.assign(new Error("Esta sección es solo para cuentas de cliente."), {
              statusCode: 403,
            });
          await transaction.execute({
            sql: `INSERT INTO client_profiles (user_id, phone, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(user_id) DO UPDATE SET phone = excluded.phone, updated_at = CURRENT_TIMESTAMP`,
            args: [user.id, phone],
          });
        });
        return response.status(200).json({ phone });
      } catch (error) {
        console.error("No se pudieron guardar los datos del cliente", error);
        return response.status(Number.isInteger(error?.statusCode) ? error.statusCode : 500).json({
          error: error instanceof Error ? error.message : "No se pudieron guardar tus datos.",
        });
      }
    }
    if (
      user &&
      (body?.action === "get-store-payment-credentials" ||
        body?.action === "save-store-payment-credentials")
    ) {
      try {
        if (!user.emailVerified)
          return response
            .status(403)
            .json({ error: "Verificá tu email antes de configurar los pagos." });
        const roleResult = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        const storeCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        if (roleResult.rows[0]?.role !== "admin" || !storeCode) {
          return response
            .status(403)
            .json({ error: "Solo un administrador con sucursal puede configurar los cobros." });
        }

        if (body.action === "get-store-payment-credentials") {
          const currentResult = await db.execute({
            sql: "SELECT public_key, encrypted_access_token FROM store_payment_credentials WHERE store_code = ?",
            args: [storeCode],
          });
          const current = currentResult.rows[0];
          return response.status(200).json({
            publicKeyConfigured: Boolean(current?.public_key),
            accessTokenConfigured: Boolean(current?.encrypted_access_token),
          });
        }

        const publicKey = typeof body.publicKey === "string" ? body.publicKey.trim() : "";
        const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
        if (publicKey.length > 500 || accessToken.length > 10000) {
          return response
            .status(400)
            .json({ error: "Las credenciales superan el tamaño permitido." });
        }
        await withWriteTransaction(db, async (transaction) => {
          await assertStoreAdmin(transaction, user.id, storeCode);
          const currentResult = await transaction.execute({
            sql: "SELECT public_key, encrypted_access_token FROM store_payment_credentials WHERE store_code = ?",
            args: [storeCode],
          });
          const current = currentResult.rows[0];
          if (!publicKey && !current?.public_key)
            throw Object.assign(new Error("Ingresá la Public Key de Mercado Pago."), {
              statusCode: 400,
            });
          if (!accessToken && !current?.encrypted_access_token) {
            throw Object.assign(new Error("Ingresá el Access Token de Mercado Pago."), {
              statusCode: 400,
            });
          }

          const nextPublicKey = publicKey || String(current.public_key);
          const encryptedAccessToken = accessToken
            ? encryptPaymentAccessToken(accessToken)
            : String(current.encrypted_access_token);
          await transaction.execute({
            sql: `INSERT INTO store_payment_credentials (store_code, public_key, encrypted_access_token, updated_at)
              VALUES (?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(store_code) DO UPDATE SET public_key = excluded.public_key,
                encrypted_access_token = excluded.encrypted_access_token, updated_at = CURRENT_TIMESTAMP`,
            args: [storeCode, nextPublicKey, encryptedAccessToken],
          });
        });
        return response
          .status(200)
          .json({ publicKeyConfigured: true, accessTokenConfigured: true });
      } catch (error) {
        console.error("No se pudieron guardar las credenciales de Mercado Pago", error);
        return response.status(Number.isInteger(error?.statusCode) ? error.statusCode : 500).json({
          error:
            error instanceof Error
              ? error.message
              : "No se pudieron guardar las credenciales de Mercado Pago.",
        });
      }
    }
    if (body?.action === "create-booking-payment-preference") {
      try {
        const bookingId = typeof body.bookingId === "string" ? body.bookingId : "";
        const cancellationToken =
          typeof body.cancellationToken === "string" ? body.cancellationToken : "";
        if (!/^[\da-f-]{36}$/i.test(bookingId))
          return response.status(400).json({ error: "Identificador de reserva inválido." });
        const bookingResult = await db.execute({
          sql: "SELECT value FROM bookings WHERE id = ?",
          args: [bookingId],
        });
        if (!bookingResult.rows[0])
          return response
            .status(404)
            .json({ error: "No encontramos el turno para preparar el pago." });
        const booking = JSON.parse(String(bookingResult.rows[0].value));
        if (!cancellationToken || booking.cancellationToken !== cancellationToken) {
          return response
            .status(403)
            .json({ error: "No se pudo validar la reserva para preparar el pago." });
        }
        if (
          !["confirmed", "pending-payment"].includes(booking.status) ||
          booking.paymentStatus === "approved" ||
          booking.customer?.paymentMethod !== "tarjeta o mercado pago"
        ) {
          return response
            .status(409)
            .json({ error: "El turno no está pendiente de pago con Mercado Pago." });
        }

        const credentials = await getStorePaymentCredentials(db, booking.storeCode);
        const host = request.headers.host || "localhost";
        const protocol = request.headers["x-forwarded-proto"] || "https";
        const appUrl = (process.env.PUBLIC_APP_URL || `${protocol}://${host}`).replace(/\/$/, "");
        const preferenceResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credentials.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            items: [
              {
                id: `booking-${bookingId}`,
                title: "Reserva de turno",
                quantity: 1,
                currency_id: "ARS",
                unit_price: Number(Number(booking.totalPrice).toFixed(2)),
              },
            ],
            payer: { email: booking.customer.email },
            external_reference: bookingId,
            notification_url: `${appUrl}/api/mercadopago/webhook?booking_id=${encodeURIComponent(bookingId)}`,
            metadata: { booking_id: bookingId, store_code: normalizeStoreCode(booking.storeCode) },
            back_urls: {
              success: `${appUrl}/reserva?payment=success&booking_id=${encodeURIComponent(bookingId)}`,
              failure: `${appUrl}/reserva?payment=failure&booking_id=${encodeURIComponent(bookingId)}`,
              pending: `${appUrl}/reserva?payment=pending&booking_id=${encodeURIComponent(bookingId)}`,
            },
            auto_return: "approved",
          }),
        });
        const preference = await preferenceResponse.json();
        if (!preferenceResponse.ok || !preference.init_point) {
          console.error("Mercado Pago booking preference failed", preferenceResponse.status);
          return response.status(502).json({ error: "Mercado Pago no pudo preparar el pago." });
        }
        return response.status(200).json({ initPoint: preference.init_point });
      } catch (error) {
        console.error("No se pudo iniciar el pago del turno", error);
        return response.status(500).json({
          error: error instanceof Error ? error.message : "No se pudo iniciar el pago del turno.",
        });
      }
    }
    if (body?.action === "verify-booking-payment") {
      try {
        const result = await verifyBookingPayment(
          db,
          String(body.bookingId ?? ""),
          body.paymentId ? String(body.paymentId) : undefined,
        );
        return response.status(200).json(result);
      } catch (error) {
        console.error("No se pudo verificar el pago del turno", error);
        return response.status(400).json({
          error: error instanceof Error ? error.message : "No se pudo verificar el pago del turno.",
        });
      }
    }
    if (body?.action === "cancel-pending-booking") {
      const bookingId = typeof body.bookingId === "string" ? body.bookingId : "";
      const cancellationToken =
        typeof body.cancellationToken === "string" ? body.cancellationToken : "";
      if (!/^[\da-f-]{36}$/i.test(bookingId) || !/^[\da-f-]{36}$/i.test(cancellationToken)) {
        return response
          .status(400)
          .json({ error: "La solicitud para cancelar la reserva no es válida." });
      }

      let transaction;
      try {
        transaction = await db.transaction("write");
        const result = await transaction.execute({
          sql: "SELECT value FROM bookings WHERE id = ?",
          args: [bookingId],
        });
        if (!result.rows[0]) {
          await transaction.rollback();
          return response.status(404).json({ error: "No encontramos la reserva pendiente." });
        }
        const booking = JSON.parse(String(result.rows[0].value));
        const requestedStoreCode = normalizeStoreCode(request.headers["x-store-code"]);
        if (normalizeStoreCode(booking.storeCode) !== requestedStoreCode) {
          await transaction.rollback();
          return response
            .status(403)
            .json({ error: "La reserva no corresponde a la sucursal seleccionada." });
        }
        if (
          booking.status !== "pending-payment" ||
          booking.cancellationToken !== cancellationToken
        ) {
          await transaction.rollback();
          return response
            .status(403)
            .json({ error: "No se puede cancelar esta reserva pendiente." });
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
    if (
      !user &&
      (body?.action === "mercadopago-payment-webhook" ||
        body?.action === "mercadopago-subscription-webhook")
    ) {
      try {
        const result = body.bookingId
          ? await verifyBookingPayment(db, String(body.bookingId), String(body.paymentId ?? ""))
          : await processMercadoPagoNotification(db, String(body.paymentId ?? ""));
        return response.status(200).json({ received: true, approved: result.approved });
      } catch (error) {
        console.error("No se pudo procesar la notificación de pago de Mercado Pago", error);
        return response.status(200).json({ received: true });
      }
    }
    if (user && body?.action === "fail-subscription-payment") {
      try {
        if (!user.emailVerified)
          return response
            .status(403)
            .json({ error: "Verificá tu email antes de comprobar el pago." });
        const purchaseId = typeof body.purchaseId === "string" ? body.purchaseId : "";
        if (!/^[a-f0-9]{36}$/i.test(purchaseId))
          return response.status(400).json({ error: "Identificador de compra inválido." });
        const orderResult = await db.execute({
          sql: "SELECT id, owner_id, status FROM subscription_orders WHERE id = ? AND method = 'mercadopago'",
          args: [purchaseId],
        });
        const order = orderResult.rows[0];
        if (!order || String(order.owner_id) !== user.id)
          return response.status(404).json({ error: "No encontramos esa compra en tu cuenta." });
        if (order.status === "paid")
          return response.status(200).json({ retryPromoAvailable: false, approved: true });
        if (order.status !== "pending") {
          const redemption = await db.execute({
            sql: "SELECT status, subscription_order_id AS subscriptionOrderId FROM subscription_discount_redemptions WHERE owner_id = ?",
            args: [user.id],
          });
          return response.status(200).json({
            retryPromoAvailable:
              redemption.rows[0]?.status === "reserved" && !redemption.rows[0]?.subscriptionOrderId,
            approved: false,
          });
        }

        const accessToken = requiredEnv("MERCADOPAGO_ACCESS_TOKEN");
        const paymentResponse = await fetch(
          `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(purchaseId)}&sort=date_created&criteria=desc`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );
        if (!paymentResponse.ok)
          throw new Error("No se pudo verificar el estado del pago en Mercado Pago.");
        const paymentSearch = await paymentResponse.json();
        const latestPayment = paymentSearch.results?.[0];
        if (latestPayment?.status === "approved") {
          await verifyMercadoPagoPayment(db, String(latestPayment.id), user.id);
          return response.status(200).json({ retryPromoAvailable: false, approved: true });
        }
        if (!latestPayment || !["rejected", "cancelled"].includes(latestPayment.status)) {
          return response.status(200).json({ retryPromoAvailable: false, approved: false });
        }
        await releaseDiscountReservationForFailedOrder(db, purchaseId);
        const redemption = await db.execute({
          sql: "SELECT status, subscription_order_id AS subscriptionOrderId FROM subscription_discount_redemptions WHERE owner_id = ?",
          args: [user.id],
        });
        return response.status(200).json({
          retryPromoAvailable:
            redemption.rows[0]?.status === "reserved" && !redemption.rows[0]?.subscriptionOrderId,
          approved: false,
        });
      } catch (error) {
        console.error("No se pudo liberar el intento de pago rechazado", error);
        return response.status(500).json({
          error: error instanceof Error ? error.message : "No se pudo verificar el pago.",
        });
      }
    }
    if (user && body?.action === "create-subscription-checkout") {
      let orderId;
      try {
        if (!user.emailVerified)
          return response
            .status(403)
            .json({ error: "Verificá tu email antes de contratar un plan." });
        const plan = SUBSCRIPTION_PLANS.get(String(body.planId));
        if (!plan)
          return response.status(400).json({ error: "Elegí uno de los planes disponibles." });
        const promoCode =
          typeof body.promoCode === "string" ? body.promoCode.trim().toUpperCase() : "";
        const discountPercent = promoCode ? subscriptionPromoDiscountPercent(promoCode) : 0;
        if (promoCode && discountPercent <= 0)
          return response.status(400).json({ error: "El código promocional no es válido." });
        if (discountPercent >= 100)
          return response
            .status(400)
            .json({ error: "Este código activa un plan gratis y no requiere pago." });
        const payableAmount = Math.round((plan.amount * (100 - discountPercent)) / 100);
        const roleResult = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        const storeCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        if (roleResult.rows[0]?.role !== "admin" || !storeCode)
          return response
            .status(403)
            .json({ error: "Solo el administrador de una sucursal puede contratar el plan." });
        const storeResult = await db.execute({
          sql: "SELECT code FROM stores WHERE code = ?",
          args: [storeCode],
        });
        if (!storeResult.rows[0])
          return response.status(404).json({ error: "No encontramos tu sucursal." });
        const accessToken = requiredEnv("MERCADOPAGO_ACCESS_TOKEN");
        const host = request.headers.host || "localhost";
        const protocol = request.headers["x-forwarded-proto"] || "https";
        const appUrl = (process.env.PUBLIC_APP_URL || `${protocol}://${host}`).replace(/\/$/, "");
        orderId = randomBytes(18).toString("hex");
        if (discountPercent === 10) {
          const transaction = await db.transaction("write");
          try {
            const redemption = await transaction.execute({
              sql: "SELECT promo_code, status, subscription_order_id AS subscriptionOrderId FROM subscription_discount_redemptions WHERE owner_id = ?",
              args: [user.id],
            });
            if (
              String(redemption.rows[0]?.promo_code ?? "") !== promoCode ||
              redemption.rows[0]?.status !== "reserved"
            ) {
              await transaction.rollback();
              return response.status(409).json({
                error: "Este código del 10% ya fue utilizado o no está aplicado a tu cuenta.",
              });
            }
            if (redemption.rows[0]?.subscriptionOrderId) {
              await transaction.rollback();
              return response.status(409).json({
                error:
                  "Hay un pago con este descuento todavía pendiente. Esperá su resultado antes de iniciar otro.",
              });
            }
            const redemptionUpdate = await transaction.execute({
              sql: "UPDATE subscription_discount_redemptions SET subscription_order_id = ? WHERE owner_id = ? AND promo_code = ? AND status = 'reserved' AND subscription_order_id IS NULL",
              args: [orderId, user.id, promoCode],
            });
            if (!redemptionUpdate.rowsAffected) {
              await transaction.rollback();
              return response.status(409).json({
                error:
                  "Hay un pago con este descuento todavía pendiente. Esperá su resultado antes de iniciar otro.",
              });
            }
            await transaction.execute({
              sql: "INSERT INTO subscription_orders (id, store_code, owner_id, months, duration_days, amount, status, method) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'mercadopago')",
              args: [orderId, storeCode, user.id, plan.months, plan.days, payableAmount],
            });
            await transaction.commit();
          } catch (error) {
            await transaction.rollback().catch(() => undefined);
            throw error;
          }
        } else {
          await db.execute({
            sql: "INSERT INTO subscription_orders (id, store_code, owner_id, months, duration_days, amount, status, method) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'mercadopago')",
            args: [orderId, storeCode, user.id, plan.months, plan.days, payableAmount],
          });
        }
        const preferenceResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [
              {
                id: `subscription-${String(body.planId)}`,
                title: `Plan de turnos por ${plan.label}${discountPercent ? ` (${discountPercent}% de descuento)` : ""}`,
                quantity: 1,
                currency_id: "ARS",
                unit_price: payableAmount,
              },
            ],
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
          await releaseDiscountReservationForFailedOrder(db, orderId);
          console.error("Mercado Pago subscription preference failed", preferenceResponse.status);
          return response.status(502).json({
            error: "Mercado Pago no pudo preparar el pago. Revisá la configuración del token.",
          });
        }
        return response
          .status(200)
          .json({ checkoutUrl: preference.init_point, purchaseId: orderId });
      } catch (error) {
        if (orderId)
          await releaseDiscountReservationForFailedOrder(db, orderId).catch(() => undefined);
        console.error("No se pudo iniciar el pago del plan", error);
        return response.status(500).json({
          error: error instanceof Error ? error.message : "No se pudo iniciar el pago del plan.",
        });
      }
    }
    if (user && body?.action === "redeem-subscription-promo") {
      try {
        if (!user.emailVerified)
          return response
            .status(403)
            .json({ error: "Verificá tu email antes de activar el plan." });
        const submittedCode = typeof body.code === "string" ? body.code.trim() : "";
        const normalizedCode = submittedCode.toUpperCase();
        const discountPercent = submittedCode
          ? subscriptionPromoDiscountPercent(normalizedCode)
          : 0;
        if (!discountPercent) {
          return response.status(400).json({ error: "El código promocional no es válido." });
        }
        const plan = SUBSCRIPTION_PLANS.get(String(body.planId));
        if (!plan)
          return response.status(400).json({ error: "Elegí uno de los planes disponibles." });
        const roleResult = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        const storeCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        if (roleResult.rows[0]?.role !== "admin" || !storeCode)
          return response
            .status(403)
            .json({ error: "Solo el administrador de una sucursal puede aplicar el código." });
        if (discountPercent === 10) {
          const transaction = await db.transaction("write");
          try {
            const existing = await transaction.execute({
              sql: "SELECT promo_code, status, subscription_order_id AS subscriptionOrderId FROM subscription_discount_redemptions WHERE owner_id = ?",
              args: [user.id],
            });
            if (existing.rows[0]) {
              const isSameReservedCode =
                String(existing.rows[0].promo_code) === normalizedCode &&
                existing.rows[0].status === "reserved";
              await transaction.rollback();
              if (isSameReservedCode && !existing.rows[0].subscriptionOrderId) {
                return response.status(200).json({ discountPercent, planLabel: plan.label });
              }
              if (isSameReservedCode) {
                return response.status(409).json({
                  error:
                    "El descuento sigue activo en un pago pendiente. Esperá que Mercado Pago informe el resultado antes de reintentar.",
                });
              }
              return response.status(409).json({
                error:
                  existing.rows[0].status === "used"
                    ? "Ya utilizaste una vez el código de descuento del 10%. No se puede volver a activar."
                    : "Ya tenés reservado otro código de descuento para tu cuenta.",
              });
            }
            await transaction.execute({
              sql: "INSERT INTO subscription_discount_redemptions (owner_id, promo_code, store_code, status) VALUES (?, ?, ?, 'reserved') ON CONFLICT(owner_id) DO NOTHING",
              args: [user.id, normalizedCode, storeCode],
            });
            const redeemed = await transaction.execute({
              sql: "SELECT promo_code FROM subscription_discount_redemptions WHERE owner_id = ?",
              args: [user.id],
            });
            if (String(redeemed.rows[0]?.promo_code ?? "") !== normalizedCode) {
              await transaction.rollback();
              return response.status(409).json({
                error:
                  "Ya utilizaste una vez el código de descuento del 10%. No se puede volver a activar.",
              });
            }
            await transaction.commit();
          } catch (error) {
            await transaction.rollback().catch(() => undefined);
            throw error;
          }
          return response.status(200).json({ discountPercent, planLabel: plan.label });
        }
        if (discountPercent !== 100)
          return response.status(400).json({ error: "El código promocional no es válido." });
        const transaction = await db.transaction("write");
        try {
          const store = await transaction.execute({
            sql: "SELECT subscription_expires_at FROM stores WHERE code = ?",
            args: [storeCode],
          });
          if (!store.rows[0]) throw new Error("No encontramos tu sucursal.");
          const currentExpiry = String(store.rows[0].subscription_expires_at ?? "");
          const startDate =
            currentExpiry && Date.parse(currentExpiry) > Date.now()
              ? currentExpiry
              : new Date().toISOString();
          const expiresAt =
            plan.days > 0
              ? addSubscriptionDays(startDate, plan.days)
              : addSubscriptionMonths(startDate, plan.months);
          const orderId = randomBytes(18).toString("hex");
          await transaction.execute({
            sql: "INSERT INTO subscription_orders (id, store_code, owner_id, months, duration_days, amount, status, method, paid_at) VALUES (?, ?, ?, ?, ?, 0, 'paid', 'promo', CURRENT_TIMESTAMP)",
            args: [orderId, storeCode, user.id, plan.months, plan.days],
          });
          await transaction.execute({
            sql: "UPDATE stores SET subscription_expires_at = ?, subscription_plan_type = 'promo' WHERE code = ?",
            args: [expiresAt, storeCode],
          });
          await transaction.commit();
          return response.status(200).json({ expiresAt, planLabel: plan.label, discountPercent });
        } catch (error) {
          await transaction.rollback().catch(() => undefined);
          throw error;
        }
      } catch (error) {
        console.error("No se pudo canjear el código promocional", error);
        return response.status(500).json({
          error: error instanceof Error ? error.message : "No se pudo activar el plan promocional.",
        });
      }
    }
    if (user && body?.action === "verify-subscription-payment") {
      try {
        if (!user.emailVerified)
          return response
            .status(403)
            .json({ error: "Verificá tu email antes de comprobar el pago." });
        const result = body.purchaseId
          ? await verifySubscriptionPurchase(db, String(body.purchaseId), user.id)
          : await verifyMercadoPagoPayment(db, String(body.paymentId ?? ""), user.id);
        return response.status(200).json(result);
      } catch (error) {
        console.error("No se pudo verificar el pago del plan", error);
        return response.status(400).json({
          error: error instanceof Error ? error.message : "No se pudo verificar el pago.",
        });
      }
    }
    if (user && body?.action === "set-account-role") {
      try {
        if (!user.emailVerified)
          return response
            .status(403)
            .json({ error: "Verificá tu email en Kinde antes de configurar el acceso." });
        const requestedRole =
          body.role === "admin" ? "admin" : body.role === "client" ? "client" : null;
        if (!requestedRole) return response.status(400).json({ error: "Tipo de cuenta inválido." });
        const transaction = await db.transaction("write");
        try {
          const existingAccount = await transaction.execute({
            sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
            args: [user.id],
          });
          const existingStoreCode = normalizeStoreCode(existingAccount.rows[0]?.store_code);
          if (
            requestedRole === "admin" &&
            existingAccount.rows[0]?.role === "admin" &&
            existingStoreCode
          ) {
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
        if (!user.emailVerified)
          return response.status(403).json({
            error: "Solo una cuenta administradora verificada puede guardar una sucursal.",
          });
        const code = normalizeStoreCode(body.store?.code);
        const name = typeof body.store?.name === "string" ? body.store.name.trim() : "";
        if (!/^[A-Z0-9][A-Z0-9_-]{2,19}$/.test(code) || name.length < 2 || name.length > 100) {
          return response.status(400).json({
            error:
              "El nombre debe tener de 2 a 100 caracteres y el código de 3 a 20 letras o números.",
          });
        }

        transaction = await db.transaction("write");
        const roleResult = await transaction.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        if (roleResult.rows[0]?.role !== "admin") {
          await transaction.rollback();
          return response.status(403).json({
            error: "Solo una cuenta administradora verificada puede guardar una sucursal.",
          });
        }

        const assignedCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        let existingStore = assignedCode
          ? await transaction.execute({
              sql: "SELECT code, settings, logo, subscription_expires_at, subscription_plan_type FROM stores WHERE code = ? AND owner_id = ?",
              args: [assignedCode, user.id],
            })
          : { rows: [] };
        if (!existingStore.rows[0]) {
          existingStore = await transaction.execute({
            sql: "SELECT code, settings, logo, subscription_expires_at, subscription_plan_type FROM stores WHERE owner_id = ? ORDER BY created_at LIMIT 1",
            args: [user.id],
          });
        }
        const currentStore = existingStore.rows[0];
        const previousCode = currentStore ? normalizeStoreCode(currentStore.code) : "";
        const duplicateCode = await transaction.execute({
          sql: "SELECT code FROM stores WHERE upper(code) = ? AND code <> ? LIMIT 1",
          args: [code, currentStore ? String(currentStore.code) : ""],
        });
        if (duplicateCode.rows[0]) {
          await transaction.rollback();
          return response
            .status(409)
            .json({ error: "Ese código de reserva ya está utilizado. Elegí otro." });
        }

        if (!currentStore) {
          await transaction.execute({
            sql: "INSERT INTO stores (code, name, owner_id) VALUES (?, ?, ?)",
            args: [code, name, user.id],
          });
        } else {
          if (previousCode !== code) {
            const professionalPrefix = `${previousCode}:`;
            await transaction.execute({
              sql: `UPDATE professionals
                SET id = ? || substr(id, ?),
                    value = json_set(value, '$.storeCode', ?),
                    updated_at = CURRENT_TIMESTAMP
                WHERE substr(id, 1, ?) = ?`,
              args: [
                code + ":",
                professionalPrefix.length + 1,
                code,
                professionalPrefix.length,
                professionalPrefix,
              ],
            });
            await transaction.execute({
              sql: `UPDATE bookings
                SET value = json_set(value, '$.storeCode', ?), updated_at = CURRENT_TIMESTAMP
                WHERE upper(json_extract(value, '$.storeCode')) = ?`,
              args: [code, previousCode],
            });
            await transaction.execute({
              sql: "UPDATE subscription_orders SET store_code = ? WHERE store_code = ?",
              args: [code, previousCode],
            });
          }
          await transaction.execute({
            sql: "UPDATE stores SET code = ?, name = ? WHERE code = ? AND owner_id = ?",
            args: [code, name, previousCode, user.id],
          });
        }
        await transaction.execute({
          sql: "UPDATE account_roles SET store_code = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
          args: [code, user.id],
        });
        await transaction.commit();
        return response.status(currentStore ? 200 : 201).json({
          ok: true,
          previousCode,
          store: {
            code,
            name,
            settings: currentStore
              ? parseStoreSettings(currentStore.settings)
              : parseStoreSettings("{}"),
            logo: typeof currentStore?.logo === "string" ? String(currentStore.logo) : "",
            subscriptionExpiresAt: currentStore?.subscription_expires_at
              ? String(currentStore.subscription_expires_at)
              : null,
            subscriptionActive: isSubscriptionActive(currentStore?.subscription_expires_at),
            subscriptionPlanType: String(currentStore?.subscription_plan_type ?? ""),
          },
        });
      } catch (error) {
        if (transaction) await transaction.rollback().catch(() => undefined);
        if (
          String(error?.message || "")
            .toLowerCase()
            .includes("unique")
        )
          return response.status(409).json({ error: "Ese código ya está utilizado. Elegí otro." });
        console.error("No se pudo guardar la sucursal", error);
        return response.status(500).json({ error: "No se pudo guardar la sucursal." });
      }
    }
    if (user && body?.action === "update-store-cancellation-policy") {
      try {
        const roleResult = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        const storeCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        if (roleResult.rows[0]?.role !== "admin" || !user.emailVerified || !storeCode) {
          return response
            .status(403)
            .json({ error: "Solo un administrador puede modificar las políticas de cancelación." });
        }
        const policy = validateCancellationPolicy(body.policy);
        if (!policy)
          return response
            .status(400)
            .json({ error: "Revisá el porcentaje de devolución y el plazo de cancelación." });
        const settings = await updateStoreSettings(db, storeCode, user.id, (current) => ({
          ...current,
          ...policy,
        }));
        return response.status(200).json({ code: storeCode, settings });
      } catch (error) {
        console.error("No se pudieron guardar las políticas de cancelación", error);
        return response.status(Number.isInteger(error?.statusCode) ? error.statusCode : 500).json({
          error:
            error instanceof Error
              ? error.message
              : "No se pudieron guardar las políticas de cancelación.",
        });
      }
    }
    if (user && body?.action === "update-store-settings") {
      try {
        const roleResult = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        const role = roleResult.rows[0]?.role;
        const storeCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        const settings = validateStoreSettings(body.settings);
        if (role !== "admin" || !user.emailVerified || !storeCode)
          return response
            .status(403)
            .json({ error: "Solo el administrador de una sucursal puede modificar sus datos." });
        if (!settings)
          return response
            .status(400)
            .json({ error: "Revisá los datos de contacto y transferencia bancaria." });
        if (!settings.transferHolder.trim())
          return response.status(400).json({ error: "El titular de la cuenta es obligatorio." });
        if (!settings.transferCbu.trim() && !settings.transferAlias.trim())
          return response
            .status(400)
            .json({ error: "Completá el CBU o el alias para recibir transferencias bancarias." });
        await withWriteTransaction(db, async (transaction) => {
          await assertStoreAdmin(transaction, user.id, storeCode);
          const updated = await transaction.execute({
            sql: "UPDATE stores SET settings = ? WHERE code = ?",
            args: [JSON.stringify(settings), storeCode],
          });
          if (!updated.rowsAffected)
            throw Object.assign(new Error("No encontramos la sucursal."), { statusCode: 404 });
        });
        return response.status(200).json({ code: storeCode, settings });
      } catch (error) {
        console.error("No se pudieron guardar los datos de la sucursal", error);
        return response.status(Number.isInteger(error?.statusCode) ? error.statusCode : 500).json({
          error: error instanceof Error
            ? error.message
            : "No se pudieron guardar los datos de la sucursal.",
        });
      }
    }
    if (user && body?.action === "update-store-pricing") {
      try {
        const roleResult = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        const storeCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        if (roleResult.rows[0]?.role !== "admin" || !user.emailVerified || !storeCode)
          return response.status(403).json({
            error: "Solo un administrador puede configurar descuentos y ajustes de precios.",
          });
        const pricing =
          body.pricing && typeof body.pricing === "object" && !Array.isArray(body.pricing)
            ? body.pricing
            : {};
        const settings = await updateStoreSettings(db, storeCode, user.id, (current) => {
          const next = validateStoreSettings({
            ...current,
            discountCoupons: pricing.discountCoupons,
            paymentPriceAdjustments: pricing.paymentPriceAdjustments,
          });
          if (!next)
            throw Object.assign(
              new Error("Revisá los códigos, descuentos y ajustes porcentuales configurados."),
              { statusCode: 400 },
            );
          return next;
        });
        return response.status(200).json({ code: storeCode, settings });
      } catch (error) {
        console.error("No se pudieron guardar descuentos y ajustes de precio", error);
        return response.status(Number.isInteger(error?.statusCode) ? error.statusCode : 500).json({
          error:
            error instanceof Error
              ? error.message
              : "No se pudieron guardar los descuentos y ajustes de precio.",
        });
      }
    }
    if (user && body?.action === "update-store-profile") {
      try {
        const roleResult = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        const role = roleResult.rows[0]?.role;
        const storeCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        if (role !== "admin" || !user.emailVerified || !storeCode)
          return response
            .status(403)
            .json({ error: "Solo el administrador de una sucursal puede modificar su perfil." });
        const storeResult = await db.execute({
          sql: "SELECT settings FROM stores WHERE code = ? AND owner_id = ?",
          args: [storeCode, user.id],
        });
        if (!storeResult.rows[0])
          return response.status(404).json({ error: "No encontramos la sucursal." });
        const profile =
          body.profile && typeof body.profile === "object" && !Array.isArray(body.profile)
            ? body.profile
            : {};
        const contact =
          profile.contact && typeof profile.contact === "object" && !Array.isArray(profile.contact)
            ? profile.contact
            : {};
        const profileChanges = {
          street: contact.street,
          height: contact.height,
          city: contact.city,
          province: contact.province,
          postalCode: contact.postalCode,
          whatsapp: contact.whatsapp,
          instagram: contact.instagram,
          description: profile.description,
          googleMapsUrl: profile.googleMapsUrl,
          googleReviewUrl: profile.googleReviewUrl,
          coverImage: profile.coverImage,
        };
        const settingsToRate = validateStoreSettings({
          ...parseStoreSettings(storeResult.rows[0].settings),
          ...Object.fromEntries(
            Object.entries(profileChanges).filter(
              ([, value]) => value !== undefined && value !== null,
            ),
          ),
        });
        if (!settingsToRate)
          return response.status(400).json({
            error: "Información guardada.",
          });
        const rating = await getGoogleMapsRating(settingsToRate.googleMapsUrl);
        const settings = await updateStoreSettings(
          db,
          storeCode,
          user.id,
          (current) => {
            const updated = validateStoreSettings({
              ...current,
              ...Object.fromEntries(
                Object.entries(profileChanges).filter(
                  ([, value]) => value !== undefined && value !== null,
                ),
              ),
            });
            if (!updated)
              throw Object.assign(new Error("Revisá los datos del perfil de la sucursal."), {
                statusCode: 400,
              });
            if (updated.googleMapsUrl !== settingsToRate.googleMapsUrl)
              throw Object.assign(
                new Error("El perfil cambió en otra operación. Actualizá e intentá de nuevo."),
                { statusCode: 409 },
              );
            updated.googleRating = rating.rating;
            updated.googleReviewCount = rating.reviewCount;
            return updated;
          },
          true,
        );
        return response.status(200).json({ code: storeCode, settings });
      } catch (error) {
        console.error("No se pudo guardar el perfil de la sucursal", error);
        return response.status(Number.isInteger(error?.statusCode) ? error.statusCode : 500).json({
          error:
            error instanceof Error ? error.message : "No se pudo guardar el perfil de la sucursal.",
        });
      }
    }
    if (user && body?.action === "update-store-logo") {
      try {
        const roleResult = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        const storeCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        const logo = body.logo ?? "";
        const validLogo =
          typeof logo === "string" &&
          logo.length <= 2_800_000 &&
          (logo === "" || /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(logo));
        if (roleResult.rows[0]?.role !== "admin" || !user.emailVerified || !storeCode) {
          return response
            .status(403)
            .json({ error: "Solo el administrador de una sucursal puede modificar su logo." });
        }
        if (!validLogo)
          return response
            .status(400)
            .json({ error: "El logo debe ser una imagen válida de hasta 2 MB." });
        await withWriteTransaction(db, async (transaction) => {
          await assertStoreAdmin(transaction, user.id, storeCode);
          const storeResult = await transaction.execute({
            sql: "SELECT code FROM stores WHERE code = ? AND owner_id = ?",
            args: [storeCode, user.id],
          });
          if (!storeResult.rows[0])
            throw Object.assign(new Error("No encontramos la sucursal."), { statusCode: 404 });
          const updated = await transaction.execute({
            sql: "UPDATE stores SET logo = ? WHERE code = ? AND owner_id = ?",
            args: [logo, storeCode, user.id],
          });
          if (!updated.rowsAffected)
            throw Object.assign(new Error("La sucursal cambió en otra operación."), {
              statusCode: 409,
            });
        });
        return response.status(200).json({ code: storeCode, logo });
      } catch (error) {
        console.error("No se pudo guardar el logo de la sucursal", error);
        return response.status(Number.isInteger(error?.statusCode) ? error.statusCode : 500).json({
          error:
            error instanceof Error
              ? error.message
              : "No se pudo guardar el logo de la sucursal.",
        });
      }
    }
    if (user && body?.action === "update-store-contact") {
      try {
        const roleResult = await db.execute({
          sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
          args: [user.id],
        });
        const role = roleResult.rows[0]?.role;
        const storeCode = normalizeStoreCode(roleResult.rows[0]?.store_code);
        if (role !== "admin" || !user.emailVerified || !storeCode)
          return response.status(403).json({
            error: "Solo el administrador de una sucursal puede modificar sus datos de contacto.",
          });
        const contact =
          body.contact && typeof body.contact === "object" && !Array.isArray(body.contact)
            ? body.contact
            : {};
        const contactChanges = {
          street: contact.street,
          height: contact.height,
          city: contact.city,
          province: contact.province,
          postalCode: contact.postalCode,
          whatsapp: contact.whatsapp,
          instagram: contact.instagram,
        };
        const settings = await updateStoreSettings(db, storeCode, user.id, (current) => {
          const next = validateStoreSettings({
            ...current,
            ...Object.fromEntries(
              Object.entries(contactChanges).filter(
                ([, value]) => value !== undefined && value !== null,
              ),
            ),
          });
          if (!next)
            throw Object.assign(new Error("Revisá los datos de contacto ingresados."), {
              statusCode: 400,
            });
          return next;
        });
        return response.status(200).json({ code: storeCode, settings });
      } catch (error) {
        console.error("No se pudieron guardar los datos de contacto", error);
        return response.status(Number.isInteger(error?.statusCode) ? error.statusCode : 500).json({
          error: error instanceof Error
            ? error.message
            : "No se pudieron guardar los datos de contacto.",
        });
      }
    }
    if (user || body?.action !== "guest-booking") {
      return response.status(400).json({ error: "Acción pública inválida." });
    }
    const booking = body.booking;
    const customer = booking?.customer;
    const id = recordId(booking);
    const slotHoldId = booking?.slotHoldId ?? "";
    if (slotHoldId && !validBookingSlotHoldId(slotHoldId))
      return response.status(400).json({ error: "La reserva temporal del horario no es válida." });
    if (booking && typeof booking === "object") delete booking.slotHoldId;
    const validEmail =
      typeof customer?.email === "string" && /^.+@.+\..+$/.test(customer.email.trim());
    const parsedDate =
      typeof booking?.date === "string" ? new Date(`${booking.date}T12:00:00Z`) : null;
    const todayInArgentina = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
    }).format(new Date());
    const validBooking =
      id &&
      id.length >= 20 &&
      typeof customer?.fullName === "string" &&
      customer.fullName.trim().length > 0 &&
      customer.fullName.length <= 160 &&
      typeof customer.phone === "string" &&
      customer.phone.trim().length >= 6 &&
      customer.phone.length <= 40 &&
      validEmail &&
      typeof booking.barberId === "string" &&
      booking.barberId.length <= 200 &&
      Array.isArray(booking.serviceIds) &&
      booking.serviceIds.length > 0 &&
      booking.serviceIds.length <= 20 &&
      typeof booking.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(booking.date) &&
      parsedDate &&
      !Number.isNaN(parsedDate.getTime()) &&
      parsedDate.toISOString().slice(0, 10) === booking.date &&
      booking.date >= todayInArgentina &&
      typeof booking.time === "string" &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(booking.time) &&
      Number.isFinite(booking.duration) &&
      booking.duration > 0 &&
      booking.duration <= 1440 &&
      Number.isFinite(booking.totalPrice) &&
      booking.totalPrice >= 0 &&
      booking.totalPrice <= 100000000 &&
      ["pending-payment", "confirmed"].includes(booking.status);
    if (!validBooking)
      return response.status(400).json({ error: "Los datos de la reserva no son válidos." });
    if (Date.parse(`${booking.date}T${booking.time}:00-03:00`) <= Date.now()) {
      return response.status(400).json({
        error: "Ese horario ya pasó y está fuera de horario. Elegí otro horario.",
      });
    }
    try {
      const storeCode = normalizeStoreCode(request.headers["x-store-code"]);
      if (!storeCode)
        return response.status(400).json({ error: "Seleccioná una sucursal para reservar." });
      const [storeResult, professionalResult] = await Promise.all([
        db.execute({
          sql: "SELECT code, subscription_expires_at, settings FROM stores WHERE code = ?",
          args: [storeCode],
        }),
        db.execute({
          sql: "SELECT value FROM professionals WHERE id = ?",
          args: [storedRecordId(storeCode, booking.barberId)],
        }),
      ]);
      if (!storeResult.rows[0])
        return response.status(404).json({ error: "No encontramos la sucursal seleccionada." });
      if (!isSubscriptionActive(storeResult.rows[0].subscription_expires_at))
        return response
          .status(403)
          .json({ error: "Esta sucursal no tiene un plan activo para aceptar reservas." });
      booking.storeCode = storeCode;
      const storeSettings = parseStoreSettings(storeResult.rows[0].settings);
      booking.cancellationPolicyAtBooking = snapshotCancellationPolicy(
        storeSettings,
      );
      if (!professionalResult.rows[0])
        return response
          .status(400)
          .json({ error: "El profesional elegido ya no está disponible." });
      const professional = JSON.parse(String(professionalResult.rows[0].value));
      if (professional.isTest)
        return response.status(400).json({ error: "No se pueden reservar turnos de prueba." });
      if (slotHoldId) {
        const holdResult = await db.execute({
          sql: `SELECT store_code, barber_id, date, time, duration FROM booking_slot_holds
            WHERE hold_id = ? AND expires_at > ?`,
          args: [slotHoldId, Date.now()],
        });
        const hold = holdResult.rows[0];
        if (
          hold &&
          (String(hold.store_code) !== storeCode ||
            String(hold.barber_id) !== booking.barberId ||
            String(hold.date) !== booking.date ||
            String(hold.time) !== booking.time ||
            Number(hold.duration) !== booking.duration)
        )
          return response
            .status(409)
            .json({ error: "El horario reservado temporalmente ya no coincide. Elegí otro." });
      }
      const serviceIds = [...new Set(booking.serviceIds)];
      if (serviceIds.length !== booking.serviceIds.length)
        return response.status(400).json({ error: "La selección de servicios no es válida." });
      const services = serviceIds.map((serviceId) =>
        professional.services?.find((service) => service.id === serviceId),
      );
      if (services.some((service) => !service))
        return response.status(400).json({ error: "Uno de los servicios ya no está disponible." });
      const expectedDuration = services.reduce((sum, service) => sum + Number(service.duration), 0);
      const submittedPrice = booking.totalPrice;
      const pricing = applyBookingPricing(
        booking,
        services.map((service) => service.price),
        storeSettings,
      );
      if (
        pricing.error ||
        booking.duration !== expectedDuration ||
        submittedPrice !== pricing.totalPrice
      ) {
        return response.status(400).json({
          error: pricing.error || "El precio o la duración del turno ya cambió. Volvé a seleccionar el servicio.",
        });
      }

      const schedule = scheduleForDate(professional, booking.date);
      let allowedSlots = professional.availableSlots ?? [];
      let scheduleEnd = null;
      if (schedule) {
        if (schedule.closed)
          return response.status(400).json({ error: "El profesional no trabaja en esa fecha." });
        const generated = scheduleSlots(schedule);
        if (!generated)
          return response.status(400).json({ error: "El horario del profesional no es válido." });
        allowedSlots = generated.slots;
        scheduleEnd = generated.endMinute;
      }
      if (!allowedSlots.includes(booking.time))
        return response
          .status(400)
          .json({ error: "Ese horario no está dentro de la disponibilidad del profesional." });
      const [hours, minutes] = booking.time.split(":").map(Number);
      const startMinute = hours * 60 + minutes;
      if (scheduleEnd !== null && startMinute + booking.duration > scheduleEnd) {
        return response
          .status(400)
          .json({ error: "El turno excede el horario de atención del profesional." });
      }

      const bookingEnd = startMinute + booking.duration;
      const notification = notificationForAdmin(
        booking,
        "new_booking",
        "Nuevo turno reservado",
        `${customer.fullName} reservó para el ${booking.date} a las ${booking.time}.`,
      );
      const statements = [
        {
          sql: `WITH RECURSIVE candidate_slots(minute) AS (
            SELECT ?
            UNION ALL
            SELECT minute + 15 FROM candidate_slots WHERE minute + 15 < ?
          )
          INSERT INTO bookings (id, value, updated_at)
          SELECT ?, ?, CURRENT_TIMESTAMP
          WHERE NOT EXISTS (
            SELECT 1 FROM candidate_slots AS slot
            WHERE (
              (
                SELECT COUNT(*) FROM bookings AS existing
                WHERE upper(json_extract(existing.value, '$.storeCode')) = ?
                  AND json_extract(existing.value, '$.barberId') = ?
                  AND json_extract(existing.value, '$.date') = ?
                  AND json_extract(existing.value, '$.status') <> 'cancelled'
                  AND slot.minute < (
                    CAST(substr(json_extract(existing.value, '$.time'), 1, 2) AS INTEGER) * 60 +
                    CAST(substr(json_extract(existing.value, '$.time'), 4, 2) AS INTEGER) +
                    CAST(json_extract(existing.value, '$.duration') AS INTEGER)
                  )
                  AND (
                    CAST(substr(json_extract(existing.value, '$.time'), 1, 2) AS INTEGER) * 60 +
                    CAST(substr(json_extract(existing.value, '$.time'), 4, 2) AS INTEGER)
                  ) < slot.minute + 15
              ) + (
                SELECT COUNT(*) FROM booking_slot_holds AS active_hold
                WHERE active_hold.store_code = ?
                  AND active_hold.barber_id = ?
                  AND active_hold.date = ?
                  AND active_hold.hold_id <> ?
                  AND active_hold.expires_at > ?
                  AND slot.minute < (
                    CAST(substr(active_hold.time, 1, 2) AS INTEGER) * 60 +
                    CAST(substr(active_hold.time, 4, 2) AS INTEGER) + active_hold.duration
                  )
                  AND (
                    CAST(substr(active_hold.time, 1, 2) AS INTEGER) * 60 +
                    CAST(substr(active_hold.time, 4, 2) AS INTEGER)
                  ) < slot.minute + 15
              )
            ) >= ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM booking_slot_holds AS own_hold
            WHERE own_hold.hold_id = ? AND own_hold.expires_at > ?
            AND (
              own_hold.store_code <> ? OR own_hold.barber_id <> ? OR
              own_hold.date <> ? OR own_hold.time <> ? OR own_hold.duration <> ?
            )
          )`,
          args: [
            startMinute,
            bookingEnd,
            id,
            JSON.stringify(booking),
            storeCode,
            booking.barberId,
            booking.date,
            storeCode,
            booking.barberId,
            booking.date,
            slotHoldId,
            Date.now(),
            bookingCapacityForDate(professional, booking.date),
            slotHoldId,
            Date.now(),
            storeCode,
            booking.barberId,
            booking.date,
            booking.time,
            booking.duration,
          ],
        },
        {
          sql: `DELETE FROM booking_slot_holds
            WHERE hold_id = ? AND store_code = ?
              AND EXISTS (SELECT 1 FROM bookings WHERE id = ?)`,
          args: [slotHoldId, storeCode, id],
        },
        ...(notification
          ? [
              {
                sql: `INSERT INTO notifications
                  (id, recipient_key, store_code, booking_id, type, title, message)
                  SELECT ?, ?, ?, ?, ?, ?, ?
                  WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ? AND value = ?)`,
                args: [...notification.args, id, JSON.stringify(booking)],
              },
            ]
          : []),
      ];
      const results = await db.batch(statements, "write");
      if (!results[0]?.rowsAffected) {
        return response.status(409).json({
          error:
            "Ese horario acaba de ser reservado o completó sus lugares disponibles. Elegí otro horario.",
        });
      }
      if (notification) await sendPushForNotification(db, notification);
      return response.status(201).json({ ok: true, booking });
    } catch (error) {
      console.error("No se pudo guardar la reserva pública", error);
      return response.status(500).json({ error: "No se pudo guardar la reserva." });
    }
  }

  if (!body || !COLLECTIONS.includes(body.collection)) {
    return response.status(400).json({ error: "Colección inválida." });
  }

  const records = body.records;
  if (!Array.isArray(records) || records.length > 2000 || JSON.stringify(body).length > 4_000_000) {
    return response.status(413).json({ error: "La sincronización supera el tamaño permitido." });
  }
  if (
    body.deleteIds !== undefined &&
    (!Array.isArray(body.deleteIds) ||
      body.deleteIds.length > 2000 ||
      body.deleteIds.some((id) => typeof id !== "string" || !id || id.length > 200))
  ) {
    return response.status(400).json({ error: "La lista de registros para eliminar no es válida." });
  }
  const deleteIds = [...new Set(body.deleteIds ?? [])];
  let role = "client";
  let storeCode = normalizeStoreCode(request.headers["x-store-code"]);
  try {
    if (user) {
      const accountRole = await db.execute({
        sql: "SELECT role, store_code FROM account_roles WHERE user_id = ?",
        args: [user.id],
      });
      if (!accountRole.rows[0] || !["admin", "client"].includes(String(accountRole.rows[0].role))) {
        return response
          .status(403)
          .json({ error: "Configurá tu tipo de cuenta antes de guardar datos." });
      }
      role = accountRole.rows[0].role;
      if (role === "admin" && user.emailVerified)
        storeCode = normalizeStoreCode(accountRole.rows[0]?.store_code);
    }
    if (!storeCode)
      return response.status(400).json({ error: "Seleccioná una sucursal antes de guardar." });
  } catch (error) {
    console.error("No se pudo verificar el rol de la cuenta", error);
    return response.status(500).json({ error: "No se pudo verificar el rol de la cuenta." });
  }

  if (body.collection === "professionals" && deleteIds.length > 0 && role !== "admin") {
    return response
      .status(403)
      .json({ error: "Solo un administrador puede eliminar profesionales." });
  }

  if (body.collection === "professionals" && role !== "admin") {
    return response
      .status(403)
      .json({ error: "Solo las cuentas administradoras pueden modificar profesionales." });
  }

  if (body.collection === "professionals") {
    const result = await saveProfessionalRecords(db, records, deleteIds, storeCode);
    if (result.status !== 200)
      console.error("No se pudieron guardar los horarios del profesional", result.body.error);
    return response.status(result.status).json(result.body);
  }

  try {
    const statements = [];
    const createdBookings = [];
    for (const record of records) {
      const id = recordId(record);
      if (!id)
        return response.status(400).json({ error: "Hay un registro con identificador inválido." });
      const slotHoldId = body.collection === "bookings" ? (record.slotHoldId ?? "") : "";
      if (slotHoldId && !validBookingSlotHoldId(slotHoldId))
        return response
          .status(400)
          .json({ error: "La reserva temporal del horario no es válida." });
      if (body.collection === "bookings") delete record.slotHoldId;
      record.storeCode = storeCode;
      const databaseId = body.collection === "professionals" ? storedRecordId(storeCode, id) : id;
      const storedRecord = await db.execute({
        sql: `SELECT value FROM ${body.collection} WHERE id = ?`,
        args: [databaseId],
      });
      if (storedRecord.rows[0]) {
        const priorRecord = JSON.parse(String(storedRecord.rows[0].value));
        if (normalizeStoreCode(priorRecord.storeCode) !== storeCode) {
          return response
            .status(403)
            .json({ error: "El registro no pertenece a la sucursal seleccionada." });
        }
        if (body.collection === "bookings")
          record.cancellationPolicyAtBooking = priorRecord.cancellationPolicyAtBooking;
        if (body.collection === "bookings")
          record.pricingPolicyAtBooking = priorRecord.pricingPolicyAtBooking;
        if (
          body.collection === "bookings" &&
          role === "admin" &&
          priorRecord.status !== record.status &&
          ["completed", "no-show"].includes(record.status) &&
          record.paymentStatus !== "approved"
        ) {
          return response.status(409).json({
            error:
              "Solo puedes indicar asistencia en turnos con el pago confirmado por el administrador.",
          });
        }
      }
      if (body.collection === "bookings" && !storedRecord.rows[0]) {
        const storeSettings = await getStoreCancellationPolicy(db, storeCode);
        record.cancellationPolicyAtBooking = snapshotCancellationPolicy(storeSettings);
        record.pricingPolicyAtBooking = {
          discountCoupons: storeSettings.discountCoupons,
          paymentPriceAdjustments: storeSettings.paymentPriceAdjustments,
        };
      }
      if (body.collection === "bookings" && role === "admin" && !storedRecord.rows[0]) {
        const availabilityError = await validateBookingAvailability(
          db,
          record,
          storeCode,
          id,
          slotHoldId,
        );
        if (availabilityError) {
          const conflict =
            availabilityError.includes("acaba de ser reservado") ||
            availabilityError.includes("completó sus lugares");
          return response.status(conflict ? 409 : 400).json({ error: availabilityError });
        }
        const transaction = await db.transaction("write");
        try {
          const capacityProfessional = await transaction.execute({
            sql: "SELECT value FROM professionals WHERE id = ?",
            args: [storedRecordId(storeCode, record.barberId)],
          });
          if (!capacityProfessional.rows[0]) {
            await transaction.rollback();
            return response
              .status(400)
              .json({ error: "El profesional elegido ya no está disponible." });
          }
          if (slotHoldId) {
            const holdResult = await transaction.execute({
              sql: `SELECT store_code, barber_id, date, time, duration FROM booking_slot_holds
                WHERE hold_id = ? AND expires_at > ?`,
              args: [slotHoldId, Date.now()],
            });
            const hold = holdResult.rows[0];
            if (
              hold &&
              (String(hold.store_code) !== storeCode ||
                String(hold.barber_id) !== record.barberId ||
                String(hold.date) !== record.date ||
                String(hold.time) !== record.time ||
                Number(hold.duration) !== record.duration)
            ) {
              await transaction.rollback();
              return response.status(409).json({
                error: "El horario reservado temporalmente ya no coincide. Elegí otro.",
              });
            }
          }
          const professionalForCapacity = JSON.parse(String(capacityProfessional.rows[0].value));
          if (
            await hasBookingConflict(
              transaction,
              record,
              storeCode,
              bookingCapacityForDate(professionalForCapacity, record.date),
              id,
              slotHoldId,
            )
          ) {
            await transaction.rollback();
            return response.status(409).json({
              error:
                "Ese horario acaba de ser reservado o completó sus lugares disponibles. Elegí otro horario.",
            });
          }
          const insertedBooking = await transaction.execute({
            sql: "INSERT INTO bookings (id, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO NOTHING",
            args: [databaseId, JSON.stringify(record)],
          });
          if (!insertedBooking.rowsAffected) {
            await transaction.rollback();
            return response.status(409).json({ error: "El turno ya fue registrado." });
          }
          if (slotHoldId) {
            await transaction.execute({
              sql: "DELETE FROM booking_slot_holds WHERE hold_id = ? AND store_code = ?",
              args: [slotHoldId, storeCode],
            });
          }
          await transaction.commit();
          createdBookings.push(record);
        } catch (error) {
          await transaction.rollback().catch(() => undefined);
          throw error;
        }
        continue;
      }
      if (body.collection === "bookings" && role !== "admin") {
        if (normalizeStoreCode(record.storeCode) !== storeCode)
          return response
            .status(403)
            .json({ error: "La reserva no corresponde a la sucursal seleccionada." });
        if (
          typeof record.customer?.email !== "string" ||
          record.customer.email.trim().toLowerCase() !== user.email
        ) {
          return response
            .status(403)
            .json({ error: "Solo puedes guardar turnos asociados a tu propio correo." });
        }
        const existing = await db.execute({
          sql: "SELECT value FROM bookings WHERE id = ?",
          args: [databaseId],
        });
        if (existing.rows[0]) {
          const prior = JSON.parse(String(existing.rows[0].value));
          if (prior.customer?.email?.trim().toLowerCase() !== user.email) {
            return response
              .status(403)
              .json({ error: "No puedes modificar un turno de otra persona." });
          }
          const immutableFields = [
            "id",
            "customer",
            "barberId",
            "serviceIds",
            "date",
            "time",
            "duration",
            "totalPrice",
            "basePrice",
            "couponCode",
            "couponDiscountAmount",
            "paymentAdjustmentAmount",
            "paymentAdjustmentMode",
            "paymentAdjustmentPercent",
            "pricingPolicyAtBooking",
            "status",
            "cancelledBy",
            "paymentReportedAt",
            "paymentCancellationStatus",
            "paymentCancellationRequestedAt",
            "refundCbu",
            "refundDestination",
            "refundDestinationType",
            "refundAmount",
            "refundRequestedAt",
            "refundConfirmedAt",
            "mercadoPagoPaymentId",
            "createdAt",
            "isTest",
          ];
          if (
            immutableFields.some(
              (field) => JSON.stringify(prior[field]) !== JSON.stringify(record[field]),
            )
          ) {
            return response.status(403).json({
              error:
                "Solo puedes confirmar tu turno; los datos de la reserva no se pueden modificar desde la cuenta cliente.",
            });
          }
          if (
            record.appointmentConfirmation !== "confirmed" &&
            record.appointmentConfirmation !== "pending"
          ) {
            return response.status(400).json({ error: "El estado de confirmación no es válido." });
          }
        } else {
          if (
            !record.customer?.fullName ||
            typeof record.customer.fullName !== "string" ||
            typeof record.customer.phone !== "string" ||
            record.customer.phone.trim().length < 6 ||
            typeof record.customer.email !== "string" ||
            !/^.+@.+\..+$/.test(record.customer.email) ||
            !Array.isArray(record.serviceIds) ||
            record.serviceIds.length === 0 ||
            !/^\d{4}-\d{2}-\d{2}$/.test(record.date) ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(record.time) ||
            !Number.isFinite(record.duration) ||
            record.duration <= 0 ||
            !Number.isFinite(record.totalPrice) ||
            record.totalPrice < 0 ||
            !["confirmed", "pending-payment"].includes(record.status)
          ) {
            return response.status(400).json({ error: "Los datos del turno no son válidos." });
          }
          const availabilityError = await validateBookingAvailability(
            db,
            record,
            storeCode,
            id,
            slotHoldId,
          );
          if (availabilityError) {
            const conflict = availabilityError.includes("acaba de ser reservado");
            return response.status(conflict ? 409 : 400).json({ error: availabilityError });
          }
          const transaction = await db.transaction("write");
          try {
            const capacityProfessional = await transaction.execute({
              sql: "SELECT value FROM professionals WHERE id = ?",
              args: [storedRecordId(storeCode, record.barberId)],
            });
            if (!capacityProfessional.rows[0]) {
              await transaction.rollback();
              return response
                .status(400)
                .json({ error: "El profesional elegido ya no está disponible." });
            }
            const professionalForCapacity = JSON.parse(String(capacityProfessional.rows[0].value));
            if (slotHoldId) {
              const holdResult = await transaction.execute({
                sql: `SELECT store_code, barber_id, date, time, duration FROM booking_slot_holds
                  WHERE hold_id = ? AND expires_at > ?`,
                args: [slotHoldId, Date.now()],
              });
              const hold = holdResult.rows[0];
              if (
                hold &&
                (String(hold.store_code) !== storeCode ||
                  String(hold.barber_id) !== record.barberId ||
                  String(hold.date) !== record.date ||
                  String(hold.time) !== record.time ||
                  Number(hold.duration) !== record.duration)
              ) {
                await transaction.rollback();
                return response.status(409).json({
                  error: "El horario reservado temporalmente ya no coincide. Elegí otro.",
                });
              }
            }
            if (
              await hasBookingConflict(
                transaction,
                record,
                storeCode,
                bookingCapacityForDate(professionalForCapacity, record.date),
                id,
                slotHoldId,
              )
            ) {
              await transaction.rollback();
              return response.status(409).json({
                error:
                  "Ese horario acaba de ser reservado o completó sus lugares disponibles. Elegí otro horario.",
              });
            }
            const insertedBooking = await transaction.execute({
              sql: "INSERT INTO bookings (id, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO NOTHING",
              args: [databaseId, JSON.stringify(record)],
            });
            if (!insertedBooking.rowsAffected) {
              await transaction.rollback();
              return response.status(409).json({ error: "El turno ya fue registrado." });
            }
            if (slotHoldId) {
              await transaction.execute({
                sql: "DELETE FROM booking_slot_holds WHERE hold_id = ? AND store_code = ?",
                args: [slotHoldId, storeCode],
              });
            }
            const notice = notificationForAdmin(
              record,
              "new_booking",
              "Nuevo turno reservado",
              `${record.customer.fullName} reservó para el ${record.date} a las ${record.time}.`,
            );
            if (notice) await persistNotification(transaction, notice);
            await transaction.commit();
            createdBookings.push(record);
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
      if (body.collection === "bookings" && !storedRecord.rows[0]) {
        createdBookings.push(record);
      }
      if (body.collection === "bookings" && role === "admin" && storedRecord.rows[0]) {
        const priorBooking = JSON.parse(String(storedRecord.rows[0].value));
        const change = describeAdminBookingChange(priorBooking, record);
        if (change) {
          const notice = notificationForClient(record, change[0], change[1], change[2]);
          if (notice) statements.push(notice);
        }
      }
    }
    for (const id of deleteIds) {
      if (role !== "admin") {
        return response.status(403).json({ error: "Solo un administrador puede eliminar turnos." });
      }
      const databaseId = body.collection === "professionals" ? storedRecordId(storeCode, id) : id;
      const existing = await db.execute({
        sql: `SELECT value FROM ${body.collection} WHERE id = ?`,
        args: [databaseId],
      });
      if (!existing.rows[0]) continue;
      if (normalizeStoreCode(JSON.parse(String(existing.rows[0].value)).storeCode) !== storeCode) {
        return response.status(403).json({ error: "El registro no pertenece a esta sucursal." });
      }
      if (body.collection === "bookings" && role === "admin") {
        const removedBooking = JSON.parse(String(existing.rows[0].value));
        if (hasPendingRefund(removedBooking)) {
          return response
            .status(409)
            .json({ error: "No se puede borrar el turno mientras la devolución esté pendiente." });
        }
        removedBooking.adminPermanentlyDeletedAt = new Date().toISOString();
        statements.push({
          sql: "UPDATE bookings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          args: [JSON.stringify(removedBooking), databaseId],
        });
        continue;
      }
      statements.push({ sql: `DELETE FROM ${body.collection} WHERE id = ?`, args: [databaseId] });
    }
    if (statements.length) await db.batch(statements, "write");
    return response.status(200).json({ ok: true, bookings: createdBookings });
  } catch (error) {
    console.error("No se pudieron guardar datos en Turso", error);
    return response.status(500).json({ error: "No se pudieron guardar los datos." });
  }
}
