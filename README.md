# Minuta

**Minuta turns every call into tasks for the right team.**

Granola records the call. Minuta works out which team it belongs to, asks Claude to pull out what was agreed using that team's playbook, and creates the tasks as issues in that team's Linear, with owners, deadlines, priority and the quote from the call that proves each one.

It works for any team that has calls and a task list: **sales, account management, marketing, customer success and internal teams**. Adding a new team takes one plain-English file.

👉 **[Try the live demo](https://amachadod.github.io/minuta/)**: five example calls from five teams, and the Linear tasks Minuta creates from each.

*Portfolio project by Alberto Machado Domínguez. The companies and calls in the examples are fictional.*

---

## How it works

```
                      ┌─ direct: every hour, Minuta asks Granola for new notes ─┐
 Granola (call notes) ┤                                                         ├─▶ Minuta ─▶ Claude ─▶ Linear
                      └─ Zapier: Granola sends each note as soon as it's saved ─┘   (team)   (tasks)   (issues)
```

1. **Record.** Granola records the call and writes notes and a transcript. You save the note to a folder such as "Sales" or "Client calls".
2. **Collect.** Minuta gets the note from Granola, either directly through Granola's API or through Zapier (see [Which setup is right for you?](#which-setup-is-right-for-you)).
3. **Route.** Minuta matches the folder to a team playbook. If the note has no folder, Claude reads the call and picks the team.
4. **Extract.** Claude reads the call with that team's playbook and returns structured tasks: title, description, owner, due date, priority, type, a quote from the call and a confidence score.
5. **Create.** Minuta checks the output and creates one Linear issue per task in that team, linked back to the Granola note.

## What a task looks like in Linear

> **Send payback model to Fjord Logistics for CFO Henrik Dahl**
> `SAL` · High · Due 30 Oct · Assigned to Maya Okafor · Labels: Minuta
>
> Build the payback model on Fjord's numbers: 3% mis-pick rate in Bergen, about 40 pickers per shift, target under 1%.
>
> **From the call:**
> > I'll put together a payback model for Henrik based on your 3% error rate and forty pickers. I can have that to you by Friday.
>
> **Call:** Northwind × Fjord Logistics: discovery call · 2026-10-26 · **Confidence:** 96%

## Team playbooks

A playbook is a Markdown file in [`playbooks/`](playbooks) that tells Claude what counts as a task for one team. Minuta ships with five:

| Playbook | Linear team | What it looks for |
|---|---|---|
| [Sales](playbooks/sales.md) | `SAL` | Next steps, material we promised, objections, new stakeholders, CRM updates |
| [Account Management](playbooks/account-management.md) | `AM` | Client requests, deliverables with dates, pending approvals, risks, growth signals |
| [Marketing](playbooks/marketing.md) | `MKT` | Campaign and budget changes, creative briefs, content, tracking fixes, tests |
| [Customer Success](playbooks/customer-success.md) | `CS` | Reported issues, onboarding steps, churn risk, feature requests, renewals |
| [Operations](playbooks/team-meeting.md) | `OPS` | Action items, decisions to communicate, blockers |

**Add your own team** (recruiting, product, legal…): copy [`playbooks/_template.md`](playbooks/_template.md), rename it and edit the text. The header says which Linear team and which Granola folders it uses:

```markdown
---
team: Recruiting
linear_team: REC
folders: Interviews, Recruiting
description: Interviews with candidates and hiring manager syncs.
---
## Always create a task for
- **Feedback to send** to the candidate, with the date we promised.
...
```

## Safeguards

Model output is checked before anything reaches Linear:

- **Only people on the call can be assigned.** If Claude names an email that wasn't an attendee, the task stays unassigned.
- **Low confidence gets flagged.** Tasks under `MIN_CONFIDENCE` (default 60%) get a "Needs review" label and no assignee.
- **Review mode.** Set `REVIEW_MODE=true` to flag every task, so the person who ran the call checks them first.
- **Evidence on every task.** Each issue quotes the line it came from.
- **Clean data.** Invalid dates and unknown priorities are dropped, not guessed.
- **The call is data, not instructions.** The prompt tells Claude to ignore any instructions spoken or written in the transcript.
- **Webhook secret.** Requests without the right `x-minuta-secret` header are rejected.

## Try it without any accounts

You need [Node.js 20+](https://nodejs.org). There are no dependencies to install.

```bash
git clone https://github.com/amachadod/minuta.git
cd minuta
npm run demo   # runs the 5 example calls through the pipeline (no API keys, nothing sent)
npm test       # 19 tests: routing, validation, safeguards, Linear mapping, webhook auth, Granola sync
```

## Which setup is right for you?

Granola is always the source of the notes. The only choice is how the notes get from Granola to Minuta.

| | **Direct** (recommended) | **Zapier** |
|---|---|---|
| Granola plan | **Business or Enterprise** (the API is only on these plans) | Any paid plan |
| Extra tools | None. GitHub runs Minuta for free | A Zapier account (likely paid) and a server such as Vercel |
| Speed | Every hour | As soon as the note is saved |
| Setup | Easier: two keys pasted into GitHub | More steps: build a Zap and deploy a webhook |

**Rule of thumb:** on Granola Business or Enterprise, use **Direct**. On any other paid plan, use **Zapier**.

Both need a **Claude API key** from the [Anthropic Console](https://console.anthropic.com) and a **Linear** workspace. In both, set `linear_team` in each playbook to your team's key (the letters in issue IDs, like `SAL-123`) and `folders` to your Granola folder names. Optionally create workspace labels in Linear named **Minuta** and **Needs review**; Minuta uses them if they exist.

### Option A: Direct (Granola Business or Enterprise)

No Zapier and no server. GitHub's free scheduler runs Minuta every hour; it collects new notes from your team folders in Granola and creates the tasks.

1. **Make a private copy.** On this repo, click **Use this template → Create a new repository** and set it to **Private**. Minuta never prints call content, but run logs of public repositories are visible to anyone.
2. **Create a Granola API key.** In the Granola desktop app: **Settings → Connectors → API keys**. Give it access to the notes you want Minuta to read.
3. **Add the secrets.** In your private copy: **Settings → Secrets and variables → Actions**.
   - Secrets: `GRANOLA_API_KEY`, `ANTHROPIC_API_KEY`, `LINEAR_API_KEY`
   - Variables: `MINUTA_ENABLED` = `true`. Optional: `DRY_RUN` = `true` for the first runs (shows what it would create without creating it), `REVIEW_MODE` = `true` to flag every task for review.
4. **Test it.** Go to **Actions → Sync Granola calls to Linear → Run workflow**. The log shows how many notes and tasks it found.

From then on it runs every hour on its own ([`.github/workflows/sync-granola.yml`](.github/workflows/sync-granola.yml)).

How it avoids duplicates: every issue Minuta creates contains a reference to its Granola note. Before processing a note, Minuta checks Linear for that reference and skips notes it has already handled. Notes edited in the last 10 minutes are left for the next run, so Granola has time to finish the summary.

Good to know: GitHub may start scheduled runs a few minutes late, and it pauses schedules on repositories with no activity for 60 days. If that happens you'll get an email, and one click in the Actions tab turns it back on.

You can also run the sync from your own computer: copy `.env.example` to `.env`, fill in the keys and run `npm run sync`.

### Option B: Zapier (any paid Granola plan)

Zapier sends each note to Minuta as soon as it's saved. Note that Granola's Zapier integration only works from its desktop apps.

**1. Configure.** Copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY`, `LINEAR_API_KEY` (Linear → Settings → Security & access → Personal API keys) and `MINUTA_WEBHOOK_SECRET`.

**2. Deploy the webhook.** Either:
- **Vercel:** import the repo, add the variables from `.env`, deploy. Your webhook is `https://<project>.vercel.app/api/granola-webhook`.
- **Locally:** `npm start`, then expose `http://localhost:8787/webhook/granola` with a tunnel such as ngrok or cloudflared.

Set `DRY_RUN=true` for the first few calls to see the tasks in the response without creating them.

**3. Connect Zapier.**
- Trigger: **Granola → Note Added to Granola Folder** (one Zap per folder, or one per team).
- Action: **Webhooks by Zapier → POST** to your webhook URL, payload type JSON, with header `x-minuta-secret: <your secret>` and these fields:

| Field | Map from Granola |
|---|---|
| `title` | Note title |
| `date` | Calendar event start |
| `folder` | Type the folder name (e.g. `Sales`) |
| `creator__name`, `creator__email` | Creator name, Creator email |
| `attendees` | Attendees (names and emails) |
| `summary` | Enhanced notes |
| `transcript` | Transcript |
| `link` | Note link |

(In Zapier, a double underscore like `creator__name` creates a nested `creator.name` field.)

## Project structure

```
src/
  granola.js     turns a note (from Zapier or the API) into a clean note
  granola-api.js direct connection to Granola's API (folders, notes, transcripts)
  sync.js        direct mode: finds new notes in team folders, skips ones already done
  playbooks.js   loads playbooks and matches folders to teams
  claude.js      routing + task extraction with Claude (structured tool output), and validation
  linear.js      safeguards, issue formatting, Linear GraphQL calls
  pipeline.js    the whole flow
  webhook.js     auth + request handling
.github/workflows/       hourly GitHub Actions run for direct mode
scripts/sync-granola.js  direct mode entry point (npm run sync)
api/granola-webhook.js   Vercel function for Zapier mode
server.js                local server (npm start)
playbooks/               one Markdown file per team
examples/                5 example calls with example Claude output
docs/                    the demo page (GitHub Pages)
test/                    node:test suite
```

## Privacy and consent

Recording a call usually requires telling everyone on it, and in the EU under GDPR you need a lawful basis to process their data. Tell participants that the call is recorded and summarised. Minuta stores nothing: the transcript goes to Claude for extraction and the resulting tasks go to Linear. Check that your company allows sending call data to both services.

## Limitations

- The demo page shows example output written for fictional calls. It does not call Claude live, because a public page can't hold an API key.
- Direct mode checks for new notes every hour, so tasks can take up to an hour to appear. Use Zapier if you need them instantly.
- Granola's Zapier fields can change. If something is missing, `src/granola.js` accepts several field names and gives a clear error.
- Tasks are only as good as the call: if nobody says who will do something, Minuta leaves it unassigned rather than guessing.

## Tech

Node.js 20+, no dependencies. Claude Messages API with forced tool use for structured output, Granola API, Linear GraphQL API, GitHub Actions, Zapier webhooks, GitHub Pages for the demo.

## About me

Alberto Machado Domínguez: advertising and PR graduate (Universidad Complutense de Madrid) with experience in account management, paid media and content. Based in Lisbon. I build tools like this to remove the busywork between client conversations and delivery. See also [Plano](https://github.com/amachadod/plano), a paid media planner.

## License

MIT. Granola, Claude, Linear and Zapier are trademarks of their respective owners. Minuta is an independent project and is not affiliated with them.
