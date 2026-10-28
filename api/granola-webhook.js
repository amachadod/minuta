// Vercel serverless function. Deployed URL: https://<your-project>.vercel.app/api/granola-webhook
import { getConfig } from "../src/config.js";
import { loadPlaybooks } from "../src/playbooks.js";
import { handleWebhook } from "../src/webhook.js";

const config = getConfig();
const playbooks = loadPlaybooks(new URL("../playbooks/", import.meta.url).pathname);

export default async function handler(req, res) {
  const { status, body } = await handleWebhook(
    { method: req.method, headers: req.headers, body: req.body },
    { config, playbooks }
  );
  res.status(status).json(body);
}
