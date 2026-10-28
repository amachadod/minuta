// The whole flow in one place:
// Granola note -> pick the team -> Claude extracts tasks -> Linear issues.

import { normalizeNote } from "./granola.js";
import { matchByFolder } from "./playbooks.js";
import { extractTasks as claudeExtract, routeNote as claudeRoute } from "./claude.js";
import { createLinearClient, planIssues, createIssues } from "./linear.js";

export async function runPipeline(payload, { config, playbooks, deps = {} }) {
  const note = normalizeNote(payload);
  const claudeOpts = { apiKey: config.anthropicKey, model: config.model, fetchImpl: deps.fetch };

  // 1. Route: Granola folder first, Claude as a fallback.
  let playbook = matchByFolder(playbooks, note.folder);
  let routedBy = "folder";
  let routeReason = `Granola folder "${note.folder}"`;
  if (!playbook) {
    const route = deps.route ? await deps.route(note, playbooks) : await claudeRoute(note, playbooks, claudeOpts);
    playbook = route.playbook;
    routedBy = "claude";
    routeReason = route.reason;
  }

  // 2. Extract tasks with the team's playbook.
  const extraction = deps.extract ? await deps.extract(note, playbook) : await claudeExtract(note, playbook, claudeOpts);

  // 3. Plan and (unless dry run) create the Linear issues.
  const planned = planIssues(extraction, note, playbook, config);
  let created = [];
  if (!config.dryRun && planned.length) {
    const client = deps.linear || createLinearClient({ apiKey: config.linearKey, fetchImpl: deps.fetch });
    created = await createIssues(planned, client);
  }

  return {
    note: { title: note.title, date: note.date, folder: note.folder },
    team: playbook.team,
    linearTeam: playbook.linearTeam,
    routedBy,
    routeReason,
    summary: extraction.summary,
    planned,
    created,
    dryRun: config.dryRun,
  };
}
