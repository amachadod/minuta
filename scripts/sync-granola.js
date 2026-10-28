// npm run sync
// Direct mode (Granola Business/Enterprise): pulls new notes from Granola and creates Linear tasks.
// GitHub Actions runs this every hour (.github/workflows/sync-granola.yml). You can also run it by hand.
import { loadDotEnv, getConfig } from "../src/config.js";
import { loadPlaybooks } from "../src/playbooks.js";
import { createGranolaClient } from "../src/granola-api.js";
import { createLinearClient } from "../src/linear.js";
import { syncGranola } from "../src/sync.js";

loadDotEnv();
const config = getConfig();
const playbooks = loadPlaybooks(config.playbooksDir);

try {
  const granola = createGranolaClient({ apiKey: config.granolaKey });
  const linear = config.dryRun ? null : createLinearClient({ apiKey: config.linearKey });
  const result = await syncGranola({ config, playbooks, granola, linear });
  if (result.errors) process.exitCode = 1;
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
