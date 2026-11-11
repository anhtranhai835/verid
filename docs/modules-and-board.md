# Modules and board

## Module flow and resources

`prep` and `recipe` always include module dossiers and a browser board, in a monorepo (one Git repository) or a workspace (multiple child repositories). Cook asks for the layout, defaulting to detection. A workspace must be outside a Git repository and contain child repositories. Existing manifests retain their layout.

| Setting   | Value       | Behaviour                                                                                           |
| --------- | ----------- | --------------------------------------------------------------------------------------------------- |
| Drive     | `big-brain` | Developer selects each task; one fresh AI session per task; developer serves.                       |
| Drive     | `no-brain`  | Owner chats on the board, reads and signs research and design there; one session follows the queue. |
| Resources | `installed` | Use installed skills and agents.                                                                    |
| Resources | `repo`      | Pin skills, agents, templates and runtime in the project; existing customizations are kept.         |

`remix` keeps its baseline workflow; the board reports that it has no tasks.

### Board: task selection and priorities

```sh
verid cook --mode prep --provider codex --yes
verid board
# With repo resources: node .verid/verid.mjs board
```

The command opens a local browser board. Keep its terminal running. Use `--no-open`
to open the printed URL yourself, or `--port 4318` to choose a port.

1. Write requirements in `.verid/spec.md` as `- REQ-1: testable behaviour` (also
   `NFR-1` and `SEC-1`). The board shows spec and plan read-only; edit them in your
   editor or ask the agent. Complete research and design before selecting a task.
2. Use **Split tasks from the spec** to seed a draft task for each live requirement and a
   final product task. Existing plans are kept. Refine task scope, ACs and
   dependencies in `.verid/plan.md`, or let the planning agent write the plan.
   Each `## Module: <name>` becomes a card; `Title:` supplies its display title.
3. In big-brain drive, select the task you want first. Selection uses `verid order` and keeps one task
   open. Copy the task's session prompt into a new AI session in a terminal or IDE.
   Big-brain drive has no board chat.
4. Follow TDD and independent review. **Approve & serve** calls `verid serve` and
   checks the same evidence as the CLI. Stop that session, select another task,
   and open another new session.

Hooks persist session ownership: a planning session, concurrent session or a
session used for another task cannot take over. Resume and compaction keep the
current task; clearing context does not let a used session take the next task.
Changed spec, plan scope or design requires reapproval and a new task session.
Nothing automatically selects or starts the next task.

Use ↑/↓ or Alt+↑/↓ on a card to reorder pending tasks. The local queue survives board restarts; `verid menu` uses the same order. Current work stays in place and `product` stays last. Big-brain drive marks the next task while allowing another selection. No-brain drive hides manual selection. Its board has a chat with the drive's one AI session (the provider's CLI runs headless: `claude -p`, `codex exec`, `agy -p`) and a **Sign research & design** button. Before the button the board shows `.verid/summary.md` (the agent's plain-language page, when present), `research.md` and `design.md`. Signing there records the same signature as `verid order` in the terminal and is refused while either file is missing. Dependencies remain advisory.

The no-brain board draws the run as a restaurant: pixel-art head chef (research and plan), sous chef (design), taster (failing test, `verid taste`), cook (code until green), inspector (review and security) and a waiter; you are the customer. The role at work moves; the others wait; with reduced motion everyone stands still. Each task sits on the pass as a ticket, RAW, COOKING, PLATED or served, from the same state as the cards. When the run needs you (halted, stuck on a question or repeated failed reviews, a hook denial in the last 15 minutes, documents to sign, all served) the waiter says why in plain words and suggests one next step; answer in the chat. The words come from state and denial codes; no model is called.

### Module dossiers

`verid module <name>` uses the project's `.verid/templates/module/`. It creates drafts
and keeps files that already exist.

| Folder      | What to record                                                                  |
| ----------- | ------------------------------------------------------------------------------- |
| `ba/`       | Problem, users, scope, EARS requirements, sources and examples.                 |
| `ui/`       | Journeys, screens, states, tokens and accessibility, or why UI is inapplicable. |
| `spec/`     | Contracts, data, invariants, errors, reuse and dependency boundaries.           |
| `tests/`    | Requirement → AC → test mapping, fixtures and runner prerequisites.             |
| `security/` | Data classification, trust boundaries, STRIDE, abuse cases and mitigations.     |
| `review/`   | The real independent review report and evidence pointers.                       |
| `release/`  | Rollout, migration, rollback and delivery evidence.                             |

Every modular plan section names its dossier:

```markdown
## Module: identity

Artifacts: .verid/artifacts/03-modules/identity
Review Focus: error handling and authorization boundaries.

- AC-1: valid credentials open the member workspace (REQ-1)
- AC-2: invalid credentials return the agreed generic error (REQ-2, SEC-1)
```

Requirement and AC IDs are unique across the project. Resolve draft clarifications before
order. The module signature includes its plan section and six input documents under
BA/UI/spec/tests/security. Changing an input requires a new order; review and release
records are outputs and do not change that signature.

The [modular cook guide](modular-cook.md) has the complete template and execution flow.

For a small change, see [small changes](small-changes.md).

### UI mockups

Set `ui: { mockups: ask }` in `.verid/manifest.yaml` (the default when omitted).
For a module that changes screens, `ask` asks once and records the answer in `ui/brief.md`;
`ascii` keeps the wireframe in that brief and creates no HTML; `browser` always prepares
2–3 self-contained HTML options without external resources in
`.verid/artifacts/03-modules/<module>/ui/mockups/`.

Open the module card's **Mockup** tab in `verid board`, preview the options, add an optional
single-line note and choose before ordering. The tab appears only when HTML options exist,
in both drives. The board writes `choice.json` with `choice` (the filename without `.html`),
`note` and `at`. The agent reads it and records the selection in `ui/brief.md`; hooks reserve
choice writes for the developer. Changing or removing this file after order requires order again.

Each preview uses an opaque-origin `iframe` sandbox, CSP that blocks network resources and
`no-referrer`. The authenticated board requests a file-bound ticket valid for 60 seconds and
one GET; the preview receives neither the board token nor access to its API. Paths outside
the mockup folder, links and non-HTML files are refused. Keep the board terminal open.

## TDD and evidence

| State      | Test writes            | Production writes                            | Next evidence                                 |
| ---------- | ---------------------- | -------------------------------------------- | --------------------------------------------- |
| RAW        | Allowed                | Blocked                                      | A new failing assertion opens implementation. |
| RAW · stub | Allowed                | A stub that lets the test reach an assertion | A failing assertion enters COOKING.           |
| COOKING    | Frozen                 | Minimum implementation                       | Passing tests enter PLATED.                   |
| PLATED     | A test edit starts RAW | Refactoring                                  | Run taste again after the change.             |

Test names include their `AC-n` code. Only `verid taste` supplies gate evidence;
other test commands are useful for diagnosis. A passing run must still match the
current files. The main thread appends the result and next AC to the module log.

Stop hooks hold incomplete work for a failing cycle, open stub or unverified change.
Reviewers remain read-only. A report or template file does not stand in for a real
test run, reviewer verdict or approval.
