// Shared request handling for the local server and the Vercel function.
import { timingSafeEqual } from "node:crypto";
import { runPipeline } from "./pipeline.js";

function sameSecret(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

// Returns { status, body } so any HTTP framework can send it.
export async function handleWebhook({ method, headers, body }, { config, playbooks, deps }) {
  if (method !== "POST") return { status: 405, body: { error: "Send a POST request with the Granola note as JSON." } };
  if (!config.webhookSecret) return { status: 500, body: { error: "MINUTA_WEBHOOK_SECRET is not set on the server." } };
  if (!sameSecret(headers["x-minuta-secret"], config.webhookSecret)) {
    return { status: 401, body: { error: "Wrong or missing x-minuta-secret header." } };
  }
  let payload = body;
  if (typeof body === "string") {
    try { payload = JSON.parse(body); } catch { return { status: 400, body: { error: "Body is not valid JSON." } }; }
  }
  try {
    const result = await runPipeline(payload, { config, playbooks, deps });
    return { status: 200, body: result };
  } catch (err) {
    console.error("[minuta]", err);
    return { status: 422, body: { error: err.message } };
  }
}
