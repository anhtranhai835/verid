# Modules and board

## Module flow and resources

`prep` and `recipe` always include module dossiers and a browser board, in a monorepo (one Git repository) or a workspace (multiple child repositories). Cook asks for the layout, defaulting to detection. A workspace must be outside a Git repository and contain child repositories. Existing manifests retain their layout.

| Setting   | Value       | Behaviour                                                                                   |
| --------- | ----------- | ------------------------------------------------------------------------------------------- |
| Drive     | `human`     | Developer selects each task; one fresh AI session per task; developer serves.               |
| Drive     | `ai`        | Developer arranges priorities and signs with `verid order`; one session follows the queue.  |
| Resources | `installed` | Use installed skills and agents.                                                            |
| Resources | `repo`      | Pin skills, agents, templates and runtime in the project; existing customizations are kept. |

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
   `NFR-1` and `SEC-1`). The board can edit spec and plan. Complete research and
   design before selecting a task.
2. Use **Tách task từ spec** to seed a draft task for each live requirement and a
   final product task. Existing plans are kept. Refine task scope, ACs and
   dependencies in **Kế hoạch task**, or let the planning agent write the plan.
   Each `## Module: <name>` becomes a card; `Title:` supplies its display title.
3. In human drive, select the task you want first. Selection uses `verid order` and keeps one task
   open. Send the prefilled session prompt from the task's **chat box**: the board
   runs the provider's CLI headless (`claude -p`, `codex exec`, `agy -p`) in the
   project and later messages resume that same session. Or copy the prompt into a
   new AI session in a terminal or IDE.
4. Follow TDD and independent review. **Duyệt & lên món** calls `verid serve` and
   checks the same evidence as the CLI. Stop that session, select another task,
   and open another new session.

Hooks persist session ownership: a planning session, concurrent session or a
session used for another task cannot take over. Resume and compaction keep the
current task; clearing context does not let a used session take the next task.
Changed spec, plan scope or design requires reapproval and a new task session.
Nothing automatically selects or starts the next task.

Use ↑/↓ or Alt+↑/↓ on a card to reorder pending tasks. The local queue survives board restarts; `verid menu` uses the same order. Current work stays in place and `product` stays last. Human drive marks the next task while allowing another selection. AI drive hides manual selection/chat; sign from your terminal to follow the queue. Dependencies remain advisory.

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
