// Playbooks are plain Markdown files in /playbooks. Each one tells Claude what counts
// as a task for one team. Adding a team = copying a file and editing the text.
//
// Format:
// ---
// team: Sales
// linear_team: SAL                 <- the team key in Linear (shown in issue IDs like SAL-123)
// folders: Sales, Discovery calls  <- Granola folder names that belong to this team
// description: One line used when Minuta has to guess the team
// ---
// Free-text instructions for Claude...

import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

export function parsePlaybook(text, file = "playbook.md") {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing the --- header block at the top.`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([a-z_]+)\s*:\s*(.*)$/i);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
  }
  for (const req of ["team", "linear_team"]) {
    if (!meta[req]) throw new Error(`${file}: the header needs a "${req}:" line.`);
  }
  return {
    id: basename(file, ".md"),
    team: meta.team,
    linearTeam: meta.linear_team,
    folders: (meta.folders || meta.team).split(",").map((s) => s.trim()).filter(Boolean),
    description: meta.description || "",
    instructions: m[2].trim(),
  };
}

export function loadPlaybooks(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  if (!files.length) throw new Error(`No playbooks found in ${dir}.`);
  return files.sort().map((f) => parsePlaybook(readFileSync(join(dir, f), "utf8"), f));
}

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Finds the playbook whose folder list contains the note's Granola folder.
// Returns null when there is no match, so the caller can ask Claude to pick.
export function matchByFolder(playbooks, folder) {
  if (!folder) return null;
  const f = norm(folder);
  return playbooks.find((p) => p.folders.some((x) => norm(x) === f)) || null;
}
