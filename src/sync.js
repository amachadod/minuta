// Direct mode: find new Granola notes in team folders and run each one through the pipeline.
// Safe to run as often as you like: notes that already have Linear issues are skipped.

import { matchByFolder } from "./playbooks.js";
import { runPipeline } from "./pipeline.js";
import { apiNoteToPayload } from "./granola-api.js";

export async function syncGranola({ config, playbooks, granola, linear, deps = {}, now = new Date(), log = console.log }) {
  const since = new Date(now.getTime() - config.lookbackHours * 3600_000).toISOString();
  const settled = now.getTime() - config.settleMinutes * 60_000;

  // 1. Which Granola folders belong to a team playbook?
  const folders = await granola.listFolders();
  const teamFolders = folders
    .map((f) => ({ folder: f, playbook: matchByFolder(playbooks, f.name) }))
    .filter((x) => x.playbook);
  log(`Granola folders matched to playbooks: ${teamFolders.length} of ${folders.length}`);

  // 2. Collect recent notes from those folders (a note in two team folders is handled once).
  const queue = new Map();
  for (const { folder } of teamFolders) {
    for (const n of await granola.listNotes({ folderId: folder.id, createdAfter: since })) {
      if (n.deleted_at || queue.has(n.id)) continue;
      queue.set(n.id, { summary: n, folderName: folder.name });
    }
  }

  const summary = { found: queue.size, processed: 0, skipped: 0, tasks: 0, errors: 0 };
  for (const [id, { summary: n, folderName }] of queue) {
    try {
      if (Date.parse(n.updated_at) > settled) { summary.skipped++; log(`${id}: still being edited, will retry next run`); continue; }
      if (!config.dryRun && (await linear.hasIssuesForNote(id))) { summary.skipped++; continue; }
      const note = await granola.getNote(id);
      const payload = apiNoteToPayload(note, folderName);
      if (!payload.transcript && !payload.summary) { summary.skipped++; log(`${id}: no transcript or summary yet`); continue; }
      const result = await runPipeline(payload, { config, playbooks, deps: { ...deps, linear } });
      summary.processed++;
      summary.tasks += result.planned.length;
      // Log IDs and counts only. Never log call content: run logs on public repos are visible to anyone.
      log(`${id}: ${result.planned.length} tasks for ${result.team}${config.dryRun ? " (dry run)" : ""}`);
    } catch (err) {
      summary.errors++;
      log(`${id}: failed: ${err.message}`);
    }
  }
  log(`Done. ${summary.processed} notes processed, ${summary.tasks} tasks, ${summary.skipped} skipped, ${summary.errors} errors.`);
  return summary;
}
