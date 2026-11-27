import * as serverModule from "../dist/server/server.js";
import dataHandler, { listPublicSitemapStores } from "./data.js";
const server = serverModule.default ?? serverModule;

const RequestImpl = globalThis.Request ?? (await import("node:undici")).Request;

function publicOrigin(req) {
  const configuredOrigin = process.env.PUBLIC_APP_URL?.trim();
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const forwardedHost = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const host = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : String(forwardedHost).split(",")[0].trim();
  const forwardedProto = req.headers["x-forwarded-proto"] || "https";
  const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : String(forwardedProto))
    .split(",")[0]
    .trim();
  const candidate =
    configuredOrigin || (vercelHost ? `https://${vercelHost}` : `${protocol}://${host}`);
  const parsed = new URL(
    /^[a-z][a-z\d+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`,
  );
  if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    parsed.protocol = "https:";
  }
  return parsed.origin;
}

function escapeXml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
    return entities[character];
  });
}

function storeSlug(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function serveSeoFile(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    return res.end("Method Not Allowed");
  }

  const origin = publicOrigin(req);
  res.statusCode = 200;
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600");

  if (pathname === "/robots.txt") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    const body = `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`;
    return res.end(req.method === "HEAD" ? undefined : body);
  }

  try {
    const stores = await listPublicSitemapStores();
    const locations = new Set([`${origin}/`, `${origin}/reserva`]);
    for (const store of stores) {
      const slug = storeSlug(store.name);
      if (slug)
        locations.add(`${origin}/${encodeURIComponent(slug)}/${encodeURIComponent(store.code)}`);
    }
    const urls = [...locations]
      .map((location) => `  <url><loc>${escapeXml(location)}</loc></url>`)
      .join("\n");
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    return res.end(req.method === "HEAD" ? undefined : body);
  } catch (error) {
    console.error("No se pudo generar el sitemap público", error);
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(req.method === "HEAD" ? undefined : "Sitemap temporalmente no disponible.");
  }
}

export default async function handler(req, res) {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url, `https://${host}`);

  if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") {
    return serveSeoFile(req, res, url.pathname);
  }

  if (url.pathname === "/api/data") {
    return dataHandler(req, res);
  }

  if (url.pathname === "/api/mercadopago/webhook") {
    if (req.method !== "POST" && req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, POST");
      return res.end("Method Not Allowed");
    }
    const paymentId =
      url.searchParams.get("data.id") ||
      url.searchParams.get("id") ||
      req.body?.data?.id ||
      req.body?.id;
    if (!paymentId) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Falta el identificador del pago." }));
    }
    req.method = "POST";
    req.body = {
      action: "mercadopago-payment-webhook",
      paymentId: String(paymentId),
      ...(url.searchParams.get("booking_id")
        ? { bookingId: url.searchParams.get("booking_id") }
        : {}),
    };
    return dataHandler(req, res);
  }

  if (url.pathname === "/api/mercadopago/preference") {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      return res.end("Method Not Allowed");
    }

    try {
      let body = req.body;
      if (typeof body === "string") {
        body = JSON.parse(body);
      } else if (!body || typeof body !== "object") {
        const chunks = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      }
      req.body = { ...body, action: "create-booking-payment-preference" };
      return dataHandler(req, res);
    } catch (error) {
      console.error("Mercado Pago preference request failed", error);
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "No se pudo procesar la solicitud de pago." }));
    }
  }

  const request = new RequestImpl(url.toString(), {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
  });

  const response = await server.fetch(request);

  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });

  if (!response.body) {
    return res.end();
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}
