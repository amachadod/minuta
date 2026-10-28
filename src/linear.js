// Creates issues in Linear through its GraphQL API (https://linear.app/developers).

const API_URL = "https://api.linear.app/graphql";
const PRIORITY = { urgent: 1, high: 2, medium: 3, low: 4 }; // Linear's own scale

export function createLinearClient({ apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("LINEAR_API_KEY is not set.");
  const cache = { teams: new Map(), users: new Map(), labels: new Map() };

  async function gql(query, variables) {
    const res = await fetchImpl(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: apiKey },
      body: JSON.stringify({ query, variables }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.errors) {
      const msg = data.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
      throw new Error(`Linear API error: ${msg}`);
    }
    return data.data;
  }

  async function teamId(key) {
    if (cache.teams.has(key)) return cache.teams.get(key);
    const d = await gql(`query($key:String!){teams(filter:{key:{eq:$key}}){nodes{id name}}}`, { key });
    const id = d.teams.nodes[0]?.id;
    if (!id) throw new Error(`No Linear team with key "${key}". Check linear_team in the playbook.`);
    cache.teams.set(key, id);
    return id;
  }

  async function userIdByEmail(email) {
    if (!email) return null;
    if (cache.users.has(email)) return cache.users.get(email);
    const d = await gql(`query($e:String!){users(filter:{email:{eq:$e}}){nodes{id}}}`, { e: email });
    const id = d.users.nodes[0]?.id || null;
    cache.users.set(email, id);
    return id;
  }

  async function labelId(name, team) {
    const k = `${team}:${name}`;
    if (cache.labels.has(k)) return cache.labels.get(k);
    const d = await gql(`query($n:String!){issueLabels(filter:{name:{eqIgnoreCase:$n}}){nodes{id team{id}}}}`, { n: name });
    // Prefer a label on this team, else a workspace label (no team).
    const node = d.issueLabels.nodes.find((l) => l.team?.id === team) || d.issueLabels.nodes.find((l) => !l.team);
    const id = node?.id || null;
    cache.labels.set(k, id);
    return id;
  }

  async function createIssue(input) {
    const d = await gql(
      `mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{id identifier url title}}}`,
      { input }
    );
    if (!d.issueCreate.success) throw new Error("Linear refused to create the issue.");
    return d.issueCreate.issue;
  }

  // True if Minuta already created issues for this Granola note. Lets the scheduled sync
  // run every hour without creating duplicates, and without storing any state.
  async function hasIssuesForNote(noteId) {
    if (!noteId) return false;
    const d = await gql(`query($ref:String!){issues(first:1,filter:{description:{contains:$ref}}){nodes{id}}}`, { ref: noteRef(noteId) });
    return d.issues.nodes.length > 0;
  }

  return { teamId, userIdByEmail, labelId, createIssue, hasIssuesForNote };
}

export const noteRef = (id) => `minuta-ref:${id}`;

export function issueDescription(task, note, { flagged }) {
  const lines = [];
  if (flagged) lines.push("> ⚠️ **Needs review.** Minuta was not fully sure about this task. Check the owner and date before starting.\n");
  if (task.description) lines.push(task.description, "");
  if (task.evidence) lines.push(`**From the call:**`, `> ${task.evidence.replace(/\n/g, "\n> ")}`, "");
  const meta = [
    `**Call:** ${note.link ? `[${note.title}](${note.link})` : note.title} · ${note.date}`,
    task.owner_name ? `**Agreed by:** ${task.owner_name}` : null,
    task.type ? `**Type:** ${task.type}` : null,
    `**Confidence:** ${Math.round(task.confidence * 100)}%`,
  ].filter(Boolean);
  lines.push(...meta, "", note.id ? `_Created by Minuta · ${noteRef(note.id)}_` : "_Created by Minuta_");
  return lines.join("\n");
}

// Decides how each task should look in Linear. Pure function, so it is easy to test.
export function planIssues(extraction, note, playbook, { reviewMode, minConfidence }) {
  const attendeeEmails = new Set(note.attendees.map((a) => a.email).filter(Boolean));
  if (note.creator.email) attendeeEmails.add(note.creator.email);
  return extraction.tasks.map((task) => {
    const flagged = reviewMode || task.confidence < minConfidence;
    // Only assign people who were actually on the call. Prevents a hallucinated email from assigning a stranger.
    const assigneeEmail = !flagged && task.owner_email && attendeeEmails.has(task.owner_email) ? task.owner_email : null;
    return {
      team: playbook.linearTeam,
      title: task.title,
      description: issueDescription(task, note, { flagged }),
      priority: PRIORITY[task.priority] ?? 3,
      dueDate: task.due_date,
      assigneeEmail,
      labels: flagged ? ["Minuta", "Needs review"] : ["Minuta"],
      flagged,
    };
  });
}

export async function createIssues(planned, client) {
  const created = [];
  for (const p of planned) {
    const teamId = await client.teamId(p.team);
    const input = { teamId, title: p.title, description: p.description, priority: p.priority };
    if (p.dueDate) input.dueDate = p.dueDate;
    const assigneeId = await client.userIdByEmail(p.assigneeEmail);
    if (assigneeId) input.assigneeId = assigneeId;
    const labelIds = (await Promise.all(p.labels.map((l) => client.labelId(l, teamId)))).filter(Boolean);
    if (labelIds.length) input.labelIds = labelIds;
    created.push(await client.createIssue(input));
  }
  return created;
}
