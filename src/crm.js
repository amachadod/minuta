// CRM output (HubSpot-style). The same tasks Minuta would put in Linear (an issue tracker) become
// CRM tasks with an owner, a due date and the quote that proves them, plus one follow-up email
// DRAFT per call. Minuta never sends email: there is no code in this project that can.
//
// Demo mode is the default: everything is planned and shown, nothing is created. With a HubSpot
// private app token, tasks (not emails) can be created through HubSpot's CRM API. That part is
// written against HubSpot's documented API and has not been tested against a live account.

const API = "https://api.hubapi.com";
const PRIORITY = { urgent: "HIGH", high: "HIGH", medium: "MEDIUM", low: "LOW" };

export const crmRef = (id) => `minuta-ref:${id}`;
const domain = (email) => (email || "").split("@")[1] || "";

// People from the other company: everyone on the call whose email domain isn't the organiser's.
export function externalAttendees(note) {
  const home = domain(note.creator?.email);
  return note.attendees.filter((a) => a.email && domain(a.email) !== home);
}

export function crmTaskBody(task, note, { flagged }) {
  const lines = [];
  if (flagged) lines.push("NEEDS REVIEW: Minuta was not fully sure about this task. Check the owner and date before starting.", "");
  if (task.description) lines.push(task.description, "");
  if (task.evidence) lines.push(`From the call: "${task.evidence}"`, "");
  lines.push(`Call: ${note.title} (${note.date})`);
  if (task.owner_name) lines.push(`Agreed by: ${task.owner_name}`);
  lines.push(`Confidence: ${Math.round(task.confidence * 100)}%`);
  if (note.id) lines.push("", `Created by Minuta · ${crmRef(note.id)}`);
  return lines.join("\n");
}

// Pure function: how each task should look in the CRM.
export function planCrmTasks(extraction, note, { reviewMode, minConfidence }) {
  const onCall = new Set(note.attendees.map((a) => a.email).filter(Boolean));
  if (note.creator?.email) onCall.add(note.creator.email);
  return extraction.tasks.map((task) => {
    const flagged = reviewMode || task.confidence < minConfidence;
    // Only people who were on the call can own a task, same rule as for Linear.
    const ownerEmail = !flagged && task.owner_email && onCall.has(task.owner_email) ? task.owner_email : null;
    return {
      subject: task.title,
      body: crmTaskBody(task, note, { flagged }),
      ownerEmail,
      ownerName: ownerEmail ? task.owner_name : null,
      dueDate: task.due_date,
      priority: PRIORITY[task.priority] || "MEDIUM",
      status: "NOT_STARTED",
      queue: flagged ? "Needs review" : null,
      evidence: task.evidence,
      confidence: task.confidence,
      flagged,
    };
  });
}

// One follow-up email per call, always a draft. Claude's version is used when it wrote one;
// otherwise a plain recap is built from the summary and the tasks.
// Internal meetings (nobody from another company) get no draft.
const INTERNAL = /crm|internal|risk|approval|decision|tracking/;
export function followUpDraft(extraction, note) {
  const to = externalAttendees(note);
  if (!to.length) return null;
  const names = to.map((a) => (a.name || a.email).split(" ")[0]);
  const fu = extraction.follow_up;
  const subject = fu?.subject || `Follow-up: ${note.title}`;
  const body = fu?.body || [
    `Hi ${names.length ? names.join(" and ") : "all"},`,
    "",
    "Thanks for your time today. Here's what we agreed:",
    ...extraction.tasks.filter((t) => t.confidence >= 0.6 && !INTERNAL.test(t.type || "")).map((t) => `- ${t.title}${t.due_date ? ` (by ${t.due_date})` : ""}`),
    "",
    "Let me know if I missed anything.",
    "",
    note.creator?.name || "",
  ].join("\n").trim();
  return {
    to: to.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)),
    subject: subject.slice(0, 160),
    body: body.slice(0, 4000),
    status: "draft",
    sent: false,
    note: "Draft only. Minuta never sends email. Copy it into your email or CRM, edit it and send it yourself.",
  };
}

export function planCrm(extraction, note, config) {
  return { tasks: planCrmTasks(extraction, note, config), followUp: followUpDraft(extraction, note) };
}

// Maps a planned task to HubSpot's task properties (CRM v3 objects API).
export function toHubSpotTask(p, ownerId, now = new Date()) {
  const due = p.dueDate ? new Date(`${p.dueDate}T09:00:00Z`) : now;
  const properties = {
    hs_task_subject: p.flagged ? `[Needs review] ${p.subject}` : p.subject,
    hs_task_body: p.body,
    hs_task_status: p.status,
    hs_task_priority: p.priority,
    hs_timestamp: due.toISOString(),
  };
  if (ownerId) properties.hubspot_owner_id = String(ownerId);
  return { properties };
}

// Creates tasks only. It has no method for emails, on purpose.
export function createHubSpotClient({ token, fetchImpl = fetch }) {
  if (!token) throw new Error("HUBSPOT_TOKEN is not set.");
  const call = async (path, init = {}) => {
    const res = await fetchImpl(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HubSpot API error ${res.status}${data.message ? `: ${String(data.message).slice(0, 160)}` : ""}`);
    return data;
  };
  const owners = new Map();
  return {
    async ownerIdByEmail(email) {
      if (!email) return null;
      if (!owners.has(email)) owners.set(email, (await call(`/crm/v3/owners/?email=${encodeURIComponent(email)}`)).results?.[0]?.id || null);
      return owners.get(email);
    },
    createTask: (body) => call("/crm/v3/objects/tasks", { method: "POST", body: JSON.stringify(body) }),
  };
}

export async function createCrmTasks(planned, client, now = new Date()) {
  const created = [];
  for (const p of planned) {
    const ownerId = await client.ownerIdByEmail(p.ownerEmail);
    const r = await client.createTask(toHubSpotTask(p, ownerId, now));
    created.push({ id: r.id || null, subject: p.subject });
  }
  return created;
}
