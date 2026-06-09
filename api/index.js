import * as serverModule from "../dist/server/server.js";
const server = serverModule.default ?? serverModule;

const RequestImpl = globalThis.Request ?? (await import("node:undici")).Request;

export default async function handler(req, res) {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url, `https://${host}`);

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
