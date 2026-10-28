// Reads settings from environment variables. See .env.example for what each one does.
import { readFileSync, existsSync } from "node:fs";

// Tiny .env loader so the project has zero dependencies.
export function loadDotEnv(path = ".env") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const [, key, raw] = m;
    if (process.env[key] === undefined) process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}

export function getConfig(env = process.env) {
  return {
    anthropicKey: env.ANTHROPIC_API_KEY || "",
    model: env.CLAUDE_MODEL || "claude-sonnet-5-5",
    linearKey: env.LINEAR_API_KEY || "",
    webhookSecret: env.MINUTA_WEBHOOK_SECRET || "",
    reviewMode: env.REVIEW_MODE === "true",
    minConfidence: Number(env.MIN_CONFIDENCE ?? 0.6),
    dryRun: env.DRY_RUN === "true",
    port: Number(env.PORT || 8787),
    playbooksDir: env.MINUTA_PLAYBOOKS_DIR || new URL("../playbooks/", import.meta.url).pathname,
  };
}
