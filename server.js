// Local webhook server: npm start
// Point Zapier (or a tunnel like ngrok / cloudflared) at http://localhost:8787/webhook/granola
import { createServer } from "node:http";
import { loadDotEnv, getConfig } from "./src/config.js";
import { loadPlaybooks } from "./src/playbooks.js";
import { handleWebhook } from "./src/webhook.js";

loadDotEnv();
const config = getConfig();
const playbooks = loadPlaybooks(config.playbooksDir);

const server = createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body, null, 2));
  };
  if (req.url === "/health") return send(200, { ok: true, teams: playbooks.map((p) => p.team) });
  if (req.url !== "/webhook/granola") return send(404, { error: "Not found. Use POST /webhook/granola" });

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) return send(413, { error: "Body too large." });
  }
  const { status, body } = await handleWebhook(
    { method: req.method, headers: req.headers, body: raw },
    { config, playbooks }
  );
  send(status, body);
});

server.listen(config.port, () => {
  console.log(`Minuta is listening on http://localhost:${config.port}/webhook/granola`);
  console.log(`Teams loaded: ${playbooks.map((p) => `${p.team} (${p.linearTeam})`).join(", ")}`);
  if (config.dryRun) console.log("DRY_RUN is on: tasks are printed, not created in Linear.");
});
