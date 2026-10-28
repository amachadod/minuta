// Turns the JSON that Zapier sends (from Granola's "Note added to folder" trigger)
// into one clean "note" object the rest of Minuta works with.
//
// In Zapier you map Granola's fields into a "Webhooks by Zapier" POST. The README shows
// the exact mapping. We accept a few spellings so small differences don't break anything.

const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = k.split(".").reduce((o, part) => (o == null ? undefined : o[part]), obj);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

function parseAttendees(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((a) => (typeof a === "string" ? parsePerson(a) : { name: a.name || "", email: (a.email || "").toLowerCase() }))
      .filter((a) => a.name || a.email);
  }
  // Zapier often flattens lists into "Ana Ruiz <ana@x.com>, Tom Hale <tom@y.com>"
  return String(raw).split(/[,;\n]/).map((s) => parsePerson(s.trim())).filter((a) => a.name || a.email);
}

function parsePerson(s) {
  const m = s.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  if (s.includes("@")) return { name: "", email: s.toLowerCase() };
  return { name: s, email: "" };
}

export function normalizeNote(payload) {
  if (!payload || typeof payload !== "object") throw new Error("The webhook body must be a JSON object.");
  const transcript = pick(payload, "transcript", "note.transcript");
  const summary = pick(payload, "summary", "enhanced_notes", "enhancedNotes", "note.summary");
  if (!transcript && !summary) {
    throw new Error("The note has no transcript or summary. In Zapier, map Granola's Transcript and Enhanced notes fields.");
  }
  const date = pick(payload, "date", "calendar_event.start", "calendarEvent.start", "created_at");
  return {
    id: String(pick(payload, "id", "note_id", "noteId") || ""),
    title: String(pick(payload, "title", "note.title", "calendar_event.title") || "Untitled call"),
    date: date ? String(date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    folder: String(pick(payload, "folder", "folder_name", "folderName") || ""),
    creator: {
      name: String(pick(payload, "creator.name", "creator_name") || ""),
      email: String(pick(payload, "creator.email", "creator_email") || "").toLowerCase(),
    },
    attendees: parseAttendees(pick(payload, "attendees")),
    summary: String(summary || ""),
    myNotes: String(pick(payload, "my_notes", "myNotes") || ""),
    transcript: String(transcript || ""),
    link: String(pick(payload, "link", "share_link", "url") || ""),
  };
}
