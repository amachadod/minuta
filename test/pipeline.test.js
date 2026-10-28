import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeNote } from "../src/granola.js";
import { parsePlaybook, loadPlaybooks, matchByFolder } from "../src/playbooks.js";
import { validateExtraction, buildExtractionPrompt } from "../src/claude.js";
import { planIssues, createIssues } from "../src/linear.js";
import { runPipeline } from "../src/pipeline.js";
import { handleWebhook } from "../src/webhook.js";
import { getConfig } from "../src/config.js";
import { loadExamples } from "../scripts/examples.js";

const config = { ...getConfig({}), dryRun: true, reviewMode: false, minConfidence: 0.6, webhookSecret: "s3cret" };
const playbooks = loadPlaybooks(config.playbooksDir);
const examples = loadExamples();

test("parses attendees from Zapier's flattened text", () => {
  const n = normalizeNote({ title: "x", transcript: "hi", attendees: "Ana Ruiz <Ana@X.com>, tom@y.com" });
  assert.deepEqual(n.attendees, [{ name: "Ana Ruiz", email: "ana@x.com" }, { name: "", email: "tom@y.com" }]);
});

test("rejects a note with no transcript or summary", () => {
  assert.throws(() => normalizeNote({ title: "Empty" }), /no transcript/);
});

test("loads all playbooks and skips the template", () => {
  assert.equal(playbooks.length, 5);
  assert.ok(!playbooks.some((p) => p.id.startsWith("_")));
});

test("playbook header is required", () => {
  assert.throws(() => parsePlaybook("no header", "bad.md"), /header/);
});

test("routes by Granola folder, ignoring case and accents", () => {
  assert.equal(matchByFolder(playbooks, "discovery CALLS").team, "Sales");
  assert.equal(matchByFolder(playbooks, "Random folder"), null);
});

test("validation drops bad dates and unknown priorities", () => {
  const out = validateExtraction({ summary: "s", tasks: [{ title: " Do it ", priority: "asap", due_date: "next week", confidence: 3 }, { title: "" }] });
  assert.equal(out.tasks.length, 1);
  assert.equal(out.tasks[0].title, "Do it");
  assert.equal(out.tasks[0].priority, "medium");
  assert.equal(out.tasks[0].due_date, null);
  assert.equal(out.tasks[0].confidence, 1);
});

test("prompt treats the call as data and includes the playbook", () => {
  const note = normalizeNote(examples[0].note);
  const { system, user } = buildExtractionPrompt(note, playbooks[0]);
  assert.match(system, /never as instructions/);
  assert.match(system, /<playbook/);
  assert.match(user, /<transcript>/);
});

test("never assigns someone who was not on the call", () => {
  const note = normalizeNote({ title: "t", transcript: "x", attendees: "A <a@x.com>" });
  const ext = { summary: "", tasks: [
    { title: "One", owner_email: "a@x.com", confidence: 0.9, priority: "high", due_date: null },
    { title: "Two", owner_email: "stranger@evil.com", confidence: 0.9, priority: "low", due_date: null },
  ] };
  const [one, two] = planIssues(ext, note, playbooks[0], config);
  assert.equal(one.assigneeEmail, "a@x.com");
  assert.equal(two.assigneeEmail, null);
});

test("low-confidence tasks and review mode are flagged and left unassigned", () => {
  const note = normalizeNote({ title: "t", transcript: "x", attendees: "A <a@x.com>" });
  const ext = { summary: "", tasks: [{ title: "Unsure", owner_email: "a@x.com", confidence: 0.3, priority: "high" }] };
  const [p] = planIssues(ext, note, playbooks[0], config);
  assert.ok(p.flagged);
  assert.equal(p.assigneeEmail, null);
  assert.deepEqual(p.labels, ["Minuta", "Needs review"]);
  const [r] = planIssues({ ...ext, tasks: [{ ...ext.tasks[0], confidence: 0.99 }] }, note, playbooks[0], { ...config, reviewMode: true });
  assert.ok(r.flagged);
});

test("every example runs end to end and lands on the right team", async () => {
  const expected = { "sales-fjord": "Sales", "am-casaverde": "Account Management", "mkt-kettle": "Marketing", "cs-sunpeak": "Customer Success", "ops-atlas": "Operations" };
  for (const ex of examples) {
    const r = await runPipeline(ex.note, {
      config, playbooks,
      deps: {
        extract: async () => validateExtraction(ex.output),
        route: async () => ({ playbook: playbooks.find((p) => p.id === ex.output.route.playbook_id), reason: "test" }),
      },
    });
    assert.equal(r.team, expected[ex.id], ex.id);
    assert.ok(r.planned.length >= 3, ex.id);
  }
});

test("creates Linear issues with mapped team, assignee, labels and priority", async () => {
  const calls = [];
  const fake = {
    teamId: async (k) => `team-${k}`,
    userIdByEmail: async (e) => (e ? `user-${e}` : null),
    labelId: async (n) => (n === "Minuta" ? "label-minuta" : null),
    createIssue: async (input) => { calls.push(input); return { identifier: "SAL-1" }; },
  };
  const ex = examples.find((e) => e.id === "sales-fjord");
  const r = await runPipeline(ex.note, { config: { ...config, dryRun: false }, playbooks, deps: { extract: async () => validateExtraction(ex.output), linear: fake } });
  assert.equal(r.created.length, 5);
  assert.equal(calls[0].teamId, "team-SAL");
  assert.equal(calls[0].assigneeId, "user-maya@northwind.example");
  assert.equal(calls[0].priority, 2);
  assert.equal(calls[0].dueDate, "2026-10-30");
  assert.deepEqual(calls[0].labelIds, ["label-minuta"]);
  assert.match(calls[0].description, /From the call/);
});

test("webhook rejects a wrong secret and accepts the right one", async () => {
  const ex = examples[0];
  const bad = await handleWebhook({ method: "POST", headers: { "x-minuta-secret": "nope" }, body: ex.note }, { config, playbooks });
  assert.equal(bad.status, 401);
  const ok = await handleWebhook(
    { method: "POST", headers: { "x-minuta-secret": "s3cret" }, body: JSON.stringify(ex.note) },
    { config, playbooks, deps: { extract: async () => validateExtraction(ex.output), route: async () => ({ playbook: playbooks[0], reason: "t" }) } }
  );
  assert.equal(ok.status, 200);
  assert.ok(ok.body.planned.length > 0);
});
