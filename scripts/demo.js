// npm run demo
// Runs every example call through the real pipeline with no API keys.
// Claude's answer comes from examples/*/tasks.json and nothing is sent to Linear.
import { getConfig } from "../src/config.js";
import { loadPlaybooks } from "../src/playbooks.js";
import { runPipeline } from "../src/pipeline.js";
import { validateExtraction } from "../src/claude.js";
import { loadExamples, mockDeps } from "./examples.js";

const config = { ...getConfig({}), dryRun: true };
const playbooks = loadPlaybooks(config.playbooksDir);
const PRI = { 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" };

for (const ex of loadExamples()) {
  const deps = mockDeps(ex, playbooks);
  deps.extract = async () => validateExtraction(ex.output);
  const r = await runPipeline(ex.note, { config, playbooks, deps });
  console.log(`\n━━ ${r.note.title} (${r.note.date})`);
  console.log(`   Team: ${r.team} [${r.linearTeam}], routed by ${r.routedBy === "folder" ? `folder "${r.note.folder}"` : "Claude"}`);
  console.log(`   ${r.summary}\n`);
  for (const p of r.planned) {
    const flag = p.flagged ? "  ⚠ needs review" : "";
    console.log(`   • ${p.title}`);
    console.log(`     ${PRI[p.priority]} · due ${p.dueDate || "—"} · ${p.assigneeEmail || "unassigned"}${flag}`);
  }
}
console.log("\nDry run: nothing was sent to Linear.");
