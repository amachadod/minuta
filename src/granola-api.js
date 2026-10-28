// Direct connection to Granola's public API (Business and Enterprise plans).
// Docs: https://docs.granola.ai/help-center/sharing/integrations/granola-api
//
// Used by scripts/sync-granola.js, which GitHub Actions runs on a schedule.
// No Zapier and no server: Minuta asks Granola for new notes itself.

const BASE = "https://public-api.granola.ai/v1";

export function createGranolaClient({ apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("GRANOLA_API_KEY is not set. Create one in Granola: Settings → Connectors → API keys.");

  async function get(path, params = {}) {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    const res = await fetchImpl(url.toString(), { headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" } });
    if (res.status === 413) return { tooLarge: true };
    if (!res.ok) {
      const msg = res.status === 401 ? "Granola rejected the API key (401). Check GRANOLA_API_KEY." : `Granola API error ${res.status} on ${path}`;
      throw new Error(msg);
    }
    return res.json();
  }

  // Follows Granola's cursor pagination until there are no more pages.
  async function all(path, key, params = {}) {
    const out = [];
    let cursor;
    do {
      const page = await get(path, { ...params, page_size: 30, cursor });
      out.push(...(page[key] || []));
      cursor = page.hasMore ? page.cursor : null;
    } while (cursor);
    return out;
  }

  const listFolders = () => all("/folders", "folders");
  const listNotes = ({ folderId, createdAfter } = {}) => all("/notes", "notes", { folder_id: folderId, created_after: createdAfter });

  async function getNote(id) {
    const note = await get(`/notes/${encodeURIComponent(id)}`, { include: "transcript" });
    if (!note.tooLarge) return note;
    // Long calls: Granola asks us to page through the transcript separately.
    const base = await get(`/notes/${encodeURIComponent(id)}`);
    base.transcript = await all(`/notes/${encodeURIComponent(id)}/transcript`, "transcript");
    return base;
  }

  return { listFolders, listNotes, getNote };
}

function speakerName(item, owner) {
  const s = item.speaker || {};
  if (s.name) return s.name;
  if (s.attribution === "me") return owner?.name || "Me";
  if (s.attribution === "them") return "Them";
  return s.diarization_label || (s.source === "microphone" ? owner?.name || "Me" : "Them");
}

// Turns a Granola API note into the same shape Zapier sends, so the rest of Minuta doesn't change.
export function apiNoteToPayload(note, folderName = "") {
  const lines = [];
  for (const item of note.transcript || []) {
    const who = speakerName(item, note.owner);
    const text = String(item.text || "").trim();
    if (!text) continue;
    // Merge consecutive lines from the same speaker so the transcript reads like a conversation.
    const last = lines[lines.length - 1];
    if (last && last.who === who) last.text += " " + text;
    else lines.push({ who, text });
  }
  return {
    id: note.id,
    title: note.title || note.calendar_event?.event_title || "Untitled call",
    date: note.calendar_event?.scheduled_start_time || note.created_at,
    folder: folderName,
    creator: { name: note.owner?.name || "", email: note.owner?.email || "" },
    attendees: (note.attendees || []).map((a) => ({ name: a.name || "", email: a.email || "" })),
    summary: note.summary_markdown || note.summary_text || "",
    my_notes: note.private_notes_markdown || note.private_notes_text || "",
    transcript: lines.map((l) => `${l.who}: ${l.text}`).join("\n"),
    link: note.web_url || "",
  };
}
