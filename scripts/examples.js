// Loads the example calls in /examples. Each folder has:
//   note.json  - what Zapier would send from Granola
//   tasks.json - an example of what Claude returns for that call
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../examples/", import.meta.url).pathname;

export function loadExamples(dir = ROOT) {
  return readdirSync(dir)
    .filter((d) => statSync(join(dir, d)).isDirectory())
    .sort()
    .map((id) => ({
      id,
      note: JSON.parse(readFileSync(join(dir, id, "note.json"), "utf8")),
      output: JSON.parse(readFileSync(join(dir, id, "tasks.json"), "utf8")),
    }));
}

// Fake Claude: returns the saved example output instead of calling the API.
export function mockDeps(example, playbooks) {
  return {
    extract: async () => example.output,
    route: async () => ({
      playbook: playbooks.find((p) => p.id === example.output.route?.playbook_id) || playbooks[0],
      reason: example.output.route?.reason || "example",
    }),
  };
}
