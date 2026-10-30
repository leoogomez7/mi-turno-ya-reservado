import * as serverModule from "../dist/server/server.js";
import dataHandler from "./data.js";
const server = serverModule.default ?? serverModule;

const RequestImpl = globalThis.Request ?? (await import("node:undici")).Request;

export default async function handler(req, res) {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url, `https://${host}`);

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
