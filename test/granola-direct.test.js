import { test } from "node:test";
import assert from "node:assert/strict";
import { createGranolaClient, apiNoteToPayload } from "../src/granola-api.js";
import { syncGranola } from "../src/sync.js";
import { loadPlaybooks } from "../src/playbooks.js";
import { getConfig } from "../src/config.js";
import { normalizeNote } from "../src/granola.js";
import { issueDescription } from "../src/linear.js";

const config = { ...getConfig({}), dryRun: false, reviewMode: false, minConfidence: 0.6, lookbackHours: 24, settleMinutes: 10 };
const playbooks = loadPlaybooks(config.playbooksDir);
const NOW = new Date("2026-10-28T12:00:00Z");

const apiNote = {
  id: "not_1d3tmYTlCICgjy",
  object: "note",
  title: "Northwind × Fjord: discovery",
  owner: { name: "Maya Okafor", email: "maya@northwind.example" },
  created_at: "2026-10-28T09:00:00Z",
  updated_at: "2026-10-28T10:00:00Z",
  web_url: "https://notes.granola.ai/d/abc",
  calendar_event: { event_title: "Discovery", scheduled_start_time: "2026-10-28T09:00:00Z" },
  attendees: [{ name: "Maya Okafor", email: "Maya@northwind.example" }, { name: "Lars Eide", email: "lars@fjord.example" }],
  summary_markdown: "## Next steps\n- Payback model by Friday",
  private_notes_markdown: null,
  transcript: [
    { speaker: { source: "microphone", attribution: "me" }, text: "I'll send the payback model", start_time: "", end_time: "" },
    { speaker: { source: "microphone", attribution: "me" }, text: "by Friday.", start_time: "", end_time: "" },
    { speaker: { source: "speaker", attribution: "them", name: "Lars Eide" }, text: "Perfect.", start_time: "", end_time: "" },
  ],
};

// Minimal fake of Granola's API, routed by URL.
function fakeFetch(routes, calls = []) {
  return async (url, opts) => {
    calls.push({ url, auth: opts?.headers?.authorization });
    const u = new URL(url);
    const key = u.pathname + (u.searchParams.get("include") ? "?include" : "") + (u.searchParams.get("cursor") ? `#${u.searchParams.get("cursor")}` : "");
    const r = routes[key];
    if (r === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (r === 413) return { ok: false, status: 413, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r };
  };
}

test("Granola client sends the bearer key and follows pagination", async () => {
  const calls = [];
  const g = createGranolaClient({
    apiKey: "grn_test",
    fetchImpl: fakeFetch({
      "/v1/folders": { folders: [{ id: "fol_aaaaaaaaaaaaaa", name: "Sales" }], hasMore: true, cursor: "p2" },
      "/v1/folders#p2": { folders: [{ id: "fol_bbbbbbbbbbbbbb", name: "Personal" }], hasMore: false, cursor: null },
    }, calls),
  });
  const folders = await g.listFolders();
  assert.equal(folders.length, 2);
  assert.equal(calls[0].auth, "Bearer grn_test");
});

test("long transcripts fall back to the paginated transcript endpoint", async () => {
  const { transcript, ...withoutTranscript } = apiNote;
  const g = createGranolaClient({
    apiKey: "k",
    fetchImpl: fakeFetch({
      [`/v1/notes/${apiNote.id}?include`]: 413,
      [`/v1/notes/${apiNote.id}`]: withoutTranscript,
      [`/v1/notes/${apiNote.id}/transcript`]: { transcript: transcript.slice(0, 2), hasMore: true, cursor: "t2" },
      [`/v1/notes/${apiNote.id}/transcript#t2`]: { transcript: transcript.slice(2), hasMore: false, cursor: null },
    }),
  });
  const note = await g.getNote(apiNote.id);
  assert.equal(note.transcript.length, 3);
});

test("API notes become the same payload Zapier sends", () => {
  const p = apiNoteToPayload(apiNote, "Sales");
  assert.equal(p.folder, "Sales");
  assert.equal(p.link, "https://notes.granola.ai/d/abc");
  assert.equal(p.transcript, "Maya Okafor: I'll send the payback model by Friday.\nLars Eide: Perfect.");
  const n = normalizeNote(p);
  assert.equal(n.date, "2026-10-28");
  assert.equal(n.attendees[0].email, "maya@northwind.example");
});

test("issue descriptions carry a reference so the sync never duplicates", () => {
  const d = issueDescription({ title: "t", confidence: 0.9 }, { id: apiNote.id, title: "x", date: "2026-10-28", link: "" }, { flagged: false });
  assert.match(d, /minuta-ref:not_1d3tmYTlCICgjy/);
});

function fakeLinear(existing = new Set()) {
  const created = [];
  return {
    created,
    hasIssuesForNote: async (id) => existing.has(id),
    teamId: async (k) => `team-${k}`,
    userIdByEmail: async () => null,
    labelId: async () => null,
    createIssue: async (input) => { created.push(input); return { identifier: "X-1" }; },
  };
}
const fakeGranola = (notes) => ({
  listFolders: async () => [{ id: "fol_s", name: "Sales" }, { id: "fol_p", name: "Personal" }, { id: "fol_c", name: "Client calls" }],
  listNotes: async ({ folderId }) => notes[folderId] || [],
  getNote: async () => apiNote,
});
const extract = async () => ({ summary: "s", tasks: [{ title: "Send payback model", priority: "high", confidence: 0.9, due_date: "2026-10-30", owner_email: "maya@northwind.example", evidence: "I'll send", description: "" }] });

test("sync only reads team folders, creates tasks once and skips notes already in Linear", async () => {
  const summaryNote = { id: apiNote.id, updated_at: apiNote.updated_at, deleted_at: null };
  const other = { id: "not_alreadydone0001", updated_at: apiNote.updated_at, deleted_at: null };
  const granola = fakeGranola({ fol_s: [summaryNote], fol_c: [summaryNote, other], fol_p: [{ id: "not_privateeeeeee", updated_at: apiNote.updated_at }] });
  const linear = fakeLinear(new Set(["not_alreadydone0001"]));
  const r = await syncGranola({ config, playbooks, granola, linear, deps: { extract }, now: NOW, log: () => {} });
  assert.equal(r.found, 2); // Personal folder ignored; duplicate across folders handled once
  assert.equal(r.processed, 1);
  assert.equal(r.skipped, 1);
  assert.equal(linear.created.length, 1);
  assert.equal(linear.created[0].teamId, "team-SAL");
  assert.match(linear.created[0].description, /minuta-ref:not_1d3tmYTlCICgjy/);
});

test("sync waits for notes that are still being edited", async () => {
  const fresh = { id: apiNote.id, updated_at: "2026-10-28T11:58:00Z", deleted_at: null };
  const linear = fakeLinear();
  const r = await syncGranola({ config, playbooks, granola: fakeGranola({ fol_s: [fresh] }), linear, deps: { extract }, now: NOW, log: () => {} });
  assert.equal(r.processed, 0);
  assert.equal(linear.created.length, 0);
});

test("sync logs counts and IDs, never call content", async () => {
  const lines = [];
  const granola = fakeGranola({ fol_s: [{ id: apiNote.id, updated_at: apiNote.updated_at }] });
  await syncGranola({ config, playbooks, granola, linear: fakeLinear(), deps: { extract }, now: NOW, log: (l) => lines.push(l) });
  const all = lines.join("\n");
  assert.ok(!all.includes("payback"));
  assert.ok(!all.includes("Fjord"));
});
