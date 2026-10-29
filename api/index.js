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
    req.body = { action: "mercadopago-subscription-webhook", paymentId: String(paymentId) };
    return dataHandler(req, res);
  }

  if (url.pathname === "/api/mercadopago/preference") {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      return res.end("Method Not Allowed");
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "El pago online no está configurado todavía." }));
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
      const amount = Number(body.amount);
      const email = String(body.email || "");

      if (!Number.isFinite(amount) || amount <= 0 || !/^.+@.+\..+$/.test(email)) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ error: "El monto o el correo no son válidos." }));
      }

      const appUrl = (process.env.PUBLIC_APP_URL || url.origin).replace(/\/$/, "");
      const preferenceResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [{
            id: "reserva-turno",
            title: String(body.description || "Reserva de turno").slice(0, 250),
            quantity: 1,
            currency_id: "ARS",
            unit_price: Number(amount.toFixed(2)),
          }],
          payer: { email },
          external_reference: crypto.randomUUID(),
          metadata: {
            customer_name: String(body.customerName || "").slice(0, 120),
            reservation_date: String(body.reservationDate || "").slice(0, 10),
            reservation_time: String(body.reservationTime || "").slice(0, 5),
          },
          back_urls: {
            success: `${appUrl}/reserva?payment=success`,
            failure: `${appUrl}/reserva?payment=failure`,
            pending: `${appUrl}/reserva?payment=pending`,
          },
          auto_return: "approved",
        }),
      });
      const preference = await preferenceResponse.json();

      if (!preferenceResponse.ok || !preference.init_point) {
        console.error("Mercado Pago preference creation failed", preferenceResponse.status);
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ error: "Mercado Pago no pudo preparar el pago. Revisá la configuración del token." }));
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ initPoint: preference.init_point }));
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
