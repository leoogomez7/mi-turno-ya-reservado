import * as serverModule from "../dist/server/server.js";
import dataHandler from "./data.js";
const server = serverModule.default ?? serverModule;

const RequestImpl = globalThis.Request ?? (await import("node:undici")).Request;
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests;",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "X-Frame-Options": "DENY",
};

function getAllowedOrigin(request) {
  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000,http://localhost:5173,https://localhost:3000,https://localhost:5173").split(",").map((origin) => origin.trim()).filter(Boolean),
  );
  const requestedOrigin = request.headers.origin;
  if (!requestedOrigin) return null;
  return allowedOrigins.has(requestedOrigin) ? requestedOrigin : null;
}

export default async function handler(req, res) {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url, `https://${host}`);
  const allowedOrigin = getAllowedOrigin(req);
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Store-Code");
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
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
    const paymentId = url.searchParams.get("data.id") || url.searchParams.get("id") || req.body?.data?.id || req.body?.id;
    if (!paymentId) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Falta el identificador del pago." }));
    }
    req.method = "POST";
    req.body = {
      action: "mercadopago-payment-webhook",
      paymentId: String(paymentId),
      ...(url.searchParams.get("booking_id") ? { bookingId: url.searchParams.get("booking_id") } : {}),
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

  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Store-Code");
    res.setHeader("Vary", "Origin");
  }

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
