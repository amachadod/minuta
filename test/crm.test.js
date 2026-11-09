import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { normalizeNote } from "../src/granola.js";
import { loadPlaybooks } from "../src/playbooks.js";
import { validateExtraction } from "../src/claude.js";
import { planCrm, toHubSpotTask, createHubSpotClient, externalAttendees } from "../src/crm.js";
import { runPipeline } from "../src/pipeline.js";
import { syncGranola } from "../src/sync.js";
import { getConfig } from "../src/config.js";
import { loadExamples } from "../scripts/examples.js";

const config = { ...getConfig({}), dryRun: true, reviewMode: false, minConfidence: 0.6, output: "crm" };
const playbooks = loadPlaybooks(config.playbooksDir);
const examples = loadExamples();
const ex = (id) => examples.find((e) => e.id === id);
const run = (id, cfg = {}, deps = {}) => runPipeline(ex(id).note, { config: { ...config, ...cfg }, playbooks, deps: { extract: async () => validateExtraction(ex(id).output), ...deps } });

test("crm: a sample call becomes CRM tasks with owner, due date, priority and the quote", async () => {
  const r = await run("crm-discovery");
  assert.equal(r.output, "crm");
  assert.equal(r.mode, "demo");
  assert.equal(r.crm.tasks.length, 4);
  const first = r.crm.tasks[0];
  assert.equal(first.ownerEmail, "priya@northwind.example");
  assert.equal(first.dueDate, "2026-11-05");
  assert.equal(first.priority, "HIGH");
  assert.match(first.body, /From the call: "I'll send you pricing for twelve seats/);
  assert.match(first.body, /minuta-ref:example-crm-discovery/);
});

test("crm: the follow-up email is a draft to the other company's people, and is never sent", async () => {
  const sent = [];
  const fakeHubSpot = { ownerIdByEmail: async () => "42", createTask: async (b) => { sent.push(b); return { id: "t1" }; } };
  const r = await run("crm-renewal", { dryRun: false }, { hubspot: fakeHubSpot });
  assert.equal(r.mode, "live");
  assert.equal(r.crm.followUp.status, "draft");
  assert.equal(r.crm.followUp.sent, false);
  assert.deepEqual(r.crm.followUp.to, ["Tom Okoro <tom@bluefintravel.example>", "Lucía Ferrer <lucia@bluefintravel.example>"]);
  // Only tasks went to the CRM. The client has no way to send email at all.
  assert.equal(sent.length, 3);
  assert.ok(sent.every((b) => Object.keys(b.properties).every((k) => k.startsWith("hs_task_") || k === "hs_timestamp" || k === "hubspot_owner_id")));
  const client = createHubSpotClient({ token: "x", fetchImpl: async () => new Response("{}") });
  assert.deepEqual(Object.keys(client).sort(), ["createTask", "ownerIdByEmail"]);
  const src = readdirSync(new URL("../src/", import.meta.url)).map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")).join("\n");
  assert.ok(!/sendmail|nodemailer|messages\/send|\/send\b|smtp/i.test(src), "no code that sends email");
});

test("crm: low-confidence tasks go to Needs review, unassigned; people not on the call are never assigned", async () => {
  const r = await run("crm-renewal");
  const approval = r.crm.tasks.find((t) => /discount/.test(t.subject));
  assert.equal(approval.flagged, true);
  assert.equal(approval.queue, "Needs review");
  assert.equal(approval.ownerEmail, null);
  assert.equal(toHubSpotTask(approval, null).properties.hs_task_subject.startsWith("[Needs review]"), true);
  const c = await run("crm-checkin");
  const sso = c.crm.tasks.find((t) => /single sign-on/.test(t.subject));
  assert.equal(sso.flagged, false);
  assert.equal(sso.ownerEmail, null, "Emma wasn't on the call");
  const review = await run("crm-discovery", { reviewMode: true });
  assert.ok(review.crm.tasks.every((t) => t.flagged && !t.ownerEmail));
});

test("crm: internal meetings get no email draft, and the draft falls back to a plain recap", async () => {
  const internal = await run("ops-atlas");
  assert.equal(internal.crm.followUp, null);
  const note = normalizeNote(ex("sales-fjord").note);
  assert.deepEqual(externalAttendees(note).map((a) => a.name), ["Lars Eide", "Ingrid Solberg"]);
  const plan = planCrm(validateExtraction(ex("sales-fjord").output), note, config);
  assert.match(plan.followUp.body, /^Hi Lars and Ingrid,/);
  assert.ok(!/Update Fjord Logistics deal/.test(plan.followUp.body), "internal CRM chores stay out of the email");
});

test("crm: no secrets in the output, and the hourly sync refuses CRM mode outside a dry run", async () => {
  const token = "pat-eu1-SECRET-0000-1111";
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, auth: init.headers.authorization }); return new Response(JSON.stringify(url.includes("owners") ? { results: [{ id: "77" }] } : { id: "t" })); };
  const r = await run("crm-discovery", { dryRun: false, hubspotToken: token }, { fetch: fetchImpl });
  assert.ok(!JSON.stringify(r).includes(token));
  assert.ok(calls.every((c) => c.url.startsWith("https://api.hubapi.com/crm/v3/") && c.auth === `Bearer ${token}`));
  assert.equal(r.created.length, 4);
  await assert.rejects(() => syncGranola({ config: { ...config, dryRun: false }, playbooks, granola: {}, linear: {}, log: () => {} }), /can't check HubSpot for duplicates/);
});
