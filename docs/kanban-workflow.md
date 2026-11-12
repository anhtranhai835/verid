# Board workflow

Every prep/recipe project has a board. Big-brain drive opens a fresh provider session per task; no-brain drive runs one session through the developer’s priority queue. Monorepo and multi-repository workspaces use the same shared board and evidence gates.

The browser board uses a restaurant kitchen theme: a chef mascot, paper order
tickets, warm colours, and a little kitchen humour. The task IDs, acceptance
criteria and evidence gates keep their existing meaning.
[Desktop preview](images/kanban-kitchen-desktop.png) · [Mobile preview](images/kanban-kitchen-mobile.png).

In big-brain drive, each task follows this loop:

```text
research → spec → design → task plan → browser selection → NEW AI session
                                       ↑                      ↓
                                  choose next ← serve ← review ← TDD
                                                ↓
                                          end that session
```

Run `verid cook` in prep or recipe mode with drive `big-brain` or `no-brain`, then run
`verid board`. The browser is a local interface to the project's existing plan,
approval state, evidence and reviews. No-brain drive puts the work on the board: a chat
with the drive's one AI session and a sign button. Big-brain drive selects and serves
tasks there; chat and signing stay in the developer's terminal or IDE.
No new browser dependencies are required.

Write `.verid/research.md`, `.verid/spec.md` and `.verid/design.md` before ordering
a task. The board shows spec and plan read-only; edit them in your editor or ask the agent.
**Split tasks from the spec** reads live `REQ-*`, `NFR-*` and `SEC-*` bullet requirements,
ignores dropped requirements, and creates a draft `.verid/plan.md` only if none
exists. Broad requirements still need a planner to refine their scope and ACs.
Generated task IDs are stable requirement IDs; AC IDs are unique across the plan.

For example:

```markdown
## Module: sign-in

Artifacts: .verid/artifacts/03-modules/sign-in

Title: Sign in with email and password
Depends: user-storage

- AC-1: Valid credentials open the member workspace (REQ-1)
- AC-2: Invalid credentials return the agreed generic error (REQ-1, SEC-1)
```

Each module is a card. The developer may select any non-product task first;
dependencies are visible advisory warnings, as in the existing module workflow.
The `product` task comes last and requires end-to-end ACs.

The columns reflect real state:

| Column           | Meaning                                                                          |
| ---------------- | -------------------------------------------------------------------------------- |
| Waiting to order | Task is planned and not selected.                                                |
| Ordered          | Developer ordered it; it awaits a fresh session.                                 |
| Cooking          | A new session has claimed the task.                                              |
| Taste & review   | The current task's ACs have passing test evidence; review and acceptance follow. |
| Served           | `serve` accepted the evidence and closed the task.                               |

In big-brain drive, selection calls the same `order` implementation as the CLI. It signs the task's
plan section and design and stores the spec hash, resets TDD for new work, and
clears previous reviews. Hook `SessionStart` binds the selected task to a new
provider/session ID. Session IDs observed during planning or used for another
task cannot bind it. Only the owning session can act while a task is open.
Resuming or compacting that session keeps ownership and evidence.

Changing the spec blocks the session until developer reapproval. Reapproval after
changed spec, plan section or design releases ownership, requires another fresh
session, and clears the previous task's evidence. Reordering an unchanged task
keeps ownership. The state and session history live in protected local
`.verid/.state/state.json` under the existing schema with backward-compatible
defaults. Hook denials use `VERID_BURNT_TASK_SESSION`, which has no agent override.

In big-brain drive, the board's session prompt identifies only the selected task; copy it into a
new session in your terminal or IDE. In no-brain drive the board's chat runs the chosen
provider's CLI headless in the project, one run at a time:

| Provider    | First message                           | Later messages                 | Permissions                                                    |
| ----------- | --------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| Claude Code | `claude -p --output-format stream-json` | `--resume <session>`           | Edits accepted; shell only verid and local git (`--settings`). |
| Codex       | `codex exec --json -`                   | `codex exec resume <thread> -` | `sandbox_mode=workspace-write`, `approval_policy=never`.       |

The prompt goes to Claude Code and Codex on stdin, never on a command line. The
first message opens the drive's session; later messages resume it, and its provider
is fixed. **Stop** stops the run. The transcript and the session ID live in the board
process only; a restarted board opens a new session, which no-brain drive allows.
Every tool call still passes verid's hook. Before **Sign research & design** the
board shows `.verid/summary.md` (when present), `research.md` and `design.md`; the
button records the same signature as `verid order` and is refused while either file
is missing.
Unknown event shapes are shown as their text. Existing TDD, role and independent review rules apply. `serve` closes the selection and tells the agent to stop.
No hook or UI operation automatically opens the next task.

Git commits follow small feature increments, rather than one large task dump.
Keep each commit coherent, independently reviewable and verified, with its related
tests. Separate unrelated features, broad refactoring and formatting. For example,
`feat(kanban): add task selection`, `feat(sessions): enforce task ownership`, and
`style(kanban): add kitchen theme` belong in separate commits. Several commits for
one task are valid; their count alone is not an audit warning. The generated
`.verid/rules/git.md` and AI instructions carry this convention across workflows.

`verid board --no-open --port 4318` serves on `127.0.0.1`. The printed URL holds
a one-time code: the first browser to open it gets an HttpOnly cookie, and the link
then stops working, so a process that reads the URL later cannot use the board.
API calls require that cookie;
mutations also require the same browser origin, JSON content and a current board
revision. There is no remote hosting or project upload. Stop the foreground
process with Ctrl+C. Server errors and evidence failures are shown in the UI.

For a source checkout, build first and use `node /path/to/verid/dist/cli.js` instead
of `verid`. For repo resources, use `node .verid/verid.mjs`. Existing projects can
run `verid upgrade --dry-run` then `verid upgrade --yes` to migrate pending module dossiers and regenerate instructions; pinned repo runtime files need an explicit update
when moving from an older version.

## Priority queue and no-brain drive

Use the ↑/↓ buttons or Alt+↑/↓ on a focused pending card. The queue survives restarts in protected local state, without changing plan signatures or review approval. The current task and served tasks cannot move; product stays last. Big-brain drive shows the next pending task but permits any selection. No-brain drive hides selection; sign on the board (or with `verid order` in your terminal), then one AI session follows `verid menu`. Module dossiers must be complete before order in either drive. Splitting the spec creates those drafts and their Artifacts references; cards report missing files and unresolved clarifications.

Remix keeps baseline behaviour; its board displays a no-task notice.
