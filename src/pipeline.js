// The whole flow in one place:
// Granola note -> pick the team -> Claude extracts tasks -> Linear issues,
// or, with MINUTA_OUTPUT=crm, CRM tasks plus a follow-up email draft (never sent).

import { normalizeNote } from "./granola.js";
import { matchByFolder } from "./playbooks.js";
import { extractTasks as claudeExtract, routeNote as claudeRoute } from "./claude.js";
import { createLinearClient, planIssues, createIssues } from "./linear.js";
import { planCrm, createHubSpotClient, createCrmTasks } from "./crm.js";

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

  // 3a. CRM output: plan CRM tasks and a follow-up draft. Without a HubSpot token this is demo mode:
  //     nothing is created. The email is a draft either way; Minuta has no way to send it.
  if (config.output === "crm") {
    const crm = planCrm(extraction, note, config);
    const live = !config.dryRun && Boolean(config.hubspotToken || deps.hubspot);
    let created = [];
    if (live && crm.tasks.length) {
      const client = deps.hubspot || createHubSpotClient({ token: config.hubspotToken, fetchImpl: deps.fetch });
      created = await createCrmTasks(crm.tasks, client);
    }
    return {
      note: { title: note.title, date: note.date, folder: note.folder },
      team: playbook.team, linearTeam: playbook.linearTeam, routedBy, routeReason,
      summary: extraction.summary, output: "crm", mode: live ? "live" : "demo",
      crm, created, planned: crm.tasks, dryRun: config.dryRun,
    };
  }

  // 3b. Plan and (unless dry run) create the Linear issues.
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
    output: "linear",
    planned,
    created,
    dryRun: config.dryRun,
  };
}
