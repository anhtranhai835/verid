# Kanban workflow

The developer controls priority and opens a fresh provider session for each task.

The browser board uses a restaurant kitchen theme: a chef mascot, paper order
tickets, warm colours, and a little kitchen humour. The task IDs, acceptance
criteria and evidence gates keep their existing meaning.
[Desktop preview](images/kanban-kitchen-desktop.png) · [Mobile preview](images/kanban-kitchen-mobile.png).

```text
research → spec → design → task plan → browser selection → NEW AI session
                                       ↑                      ↓
                                  choose next ← serve ← review ← TDD
                                                ↓
                                          end that session
```

Choose `--workflow kanban` in `verid cook` (prep or recipe, human drive), then run
`verid board`. The browser is a local interface to the project's existing plan,
approval state, evidence and reviews. It does not call a cloud model or launch a
provider conversation automatically. No new browser dependencies are required.

Write `.verid/research.md`, `.verid/spec.md` and `.verid/design.md` before ordering
a task. Spec and plan can be edited from the board while no task is open.
**Tách task từ spec** reads live `REQ-*`, `NFR-*` and `SEC-*` bullet requirements,
ignores dropped requirements, and creates a draft `.verid/plan.md` only if none
exists. Broad requirements still need a planner to refine their scope and ACs.
Generated task IDs are stable requirement IDs; AC IDs are unique across the plan.

For example:

```markdown
## Module: sign-in

Title: Sign in with email and password
Depends: user-storage

- AC-1: Valid credentials open the member workspace (REQ-1)
- AC-2: Invalid credentials return the agreed generic error (REQ-1, SEC-1)
```

Each module is a card. The developer may select any non-product task first;
dependencies are visible advisory warnings, as in the existing module workflow.
The `product` task comes last and requires end-to-end ACs.

The columns reflect real state:

| Column      | Meaning                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| Chờ gọi món | Task is planned and not selected.                                                |
| Đã chốt món | Developer ordered it; it awaits a fresh session.                                 |
| Đang nấu    | A new session has claimed the task.                                              |
| Nếm & duyệt | The current task's ACs have passing test evidence; review and acceptance follow. |
| Lên bàn     | `serve` accepted the evidence and closed the task.                               |

Selection calls the same `order` implementation as the CLI. It signs the task's
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

The board's session prompt identifies only the selected task. Copy it into a new
Codex or Claude Code session in the project. Existing TDD, role and independent
review rules apply. `serve` closes the selection and tells the agent to stop.
No hook or UI operation automatically opens the next task.

Git commits follow small feature increments, rather than one large task dump.
Keep each commit coherent, independently reviewable and verified, with its related
tests. Separate unrelated features, broad refactoring and formatting. For example,
`feat(kanban): add task selection`, `feat(sessions): enforce task ownership`, and
`style(kanban): add kitchen theme` belong in separate commits. Several commits for
one task are valid; their count alone is not an audit warning. The generated
`.verid/rules/git.md` and AI instructions carry this convention across workflows.

`verid board --no-open --port 4318` serves on `127.0.0.1`. The printed URL contains
a per-launch credential in its fragment. API calls require that credential;
mutations also require the same browser origin, JSON content and a current board
revision. There is no remote hosting or project upload. Stop the foreground
process with Ctrl+C. Server errors and evidence failures are shown in the UI.

For a source checkout, build first and use `node /path/to/aeriq/dist/cli.js` instead
of `verid`. For repo resources, use `node .verid/verid.mjs`. Existing projects can
set `workflow: kanban` and `drive: human` in the manifest and run `upgrade --yes`
to regenerate instructions; pinned repo runtime files need an explicit update
when moving from an older version.
