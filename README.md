```
 ██╗   ██╗ ███████╗ ██████╗  ██╗ ██████╗
 ██║   ██║ ██╔════╝ ██╔══██╗ ██║ ██╔══██╗
 ██║   ██║ █████╗   ██████╔╝ ██║ ██║  ██║
 ╚██╗ ██╔╝ ██╔══╝   ██╔══██╗ ██║ ██║  ██║
  ╚████╔╝  ███████╗ ██║  ██║ ██║ ██████╔╝
   ╚═══╝   ╚══════╝ ╚═╝  ╚═╝ ╚═╝ ╚═════╝
     hook-enforced TDD for Claude Code and Codex · RAW → COOKING → PLATED
```

# verid

**English** · [Tiếng Việt](README.vi.md)

> A spec and TDD harness for Claude Code and Codex, with hooks that check each write.

verid takes an idea, a specification or an existing codebase through a reviewable development cycle:

```text
research → spec → design → plan → order → build & test → review → serve
                                           RAW → COOKING → PLATED
```

Requirements, decisions and module documents live in `.verid/`. The CLI records test
evidence and checks approvals; the agent follows the installed skills or the copies
committed with your project.

---

## Why use verid?

A project needs agreement on behaviour, interfaces and acceptance criteria before
implementation. verid makes that agreement visible in documents and connects it to tests.

- **Plan by module.** Each module has testable ACs; the developer decides when work can start.
- **Use recorded evidence.** `verid taste` checks the runner exit code and JUnit report.
- **Keep roles focused.** Claude Code can separate tester, coder and reviewer. Codex uses
  main for tests and code, with an independent reviewer that only reads.
- **Carry the workflow with the repo.** The modular workflow has a dossier for each
  module; repo resources include agents, skills, templates and a pinned hook runtime.
- **Resume from facts.** `verid menu` shows module progress, audit findings and the next step.

---

## Requirements

- Node.js **22 or later**, with npm on `PATH`.
- Git for repository and workspace operations.
- Claude Code, Codex CLI, or both.

## Installation

### Published package (optional global installation)

```sh
npm install -g @anhtranhai835/verid
```

The one-line installers install the published npm package and attempt provider setup.
They need Node.js already installed.

**Windows — PowerShell**

```powershell
irm https://raw.githubusercontent.com/anhtranhai835/aeriq/main/install.ps1 | iex
```

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/anhtranhai835/aeriq/main/install.sh | sh
```

In an interactive terminal, the installer can ask for a project folder and start
`verid cook`. In CI or without a terminal, run cook yourself afterward.

### Current source, including the new modular workflow

Use the source build when the published npm version does not yet include a feature
described in this README:

```sh
git clone https://github.com/anhtranhai835/aeriq.git
cd aeriq
npm ci
npm run build
```

Run the built CLI once from the target project, replacing the path with your checkout:

```sh
node /path/to/aeriq/dist/cli.js cook --mode prep --resources repo --provider codex --yes
```

After cook, the repo includes its own CLI and bundled dependencies. From the project root:

```sh
node .verid/verid.mjs module identity
node .verid/verid.mjs menu
node .verid/verid.mjs taste
```

No global verid install or separate verid `node_modules` is required for repo mode.
Node.js, your provider and the project's test runner remain prerequisites.
The optional global executable is `verid`; the npm package is `@anhtranhai835/verid`.

---

## Quick start

In the project you want to work on:

```sh
cd your-project
verid cook
```

Cook asks for language, providers, layout, resource location, mode, drive and
architecture. It detects the layout and test runners, then previews the files to write.
Confirm the preview to apply it.

Put the documents you already have in `.verid/docs/`. Open your provider at the
project or workspace root and ask:

> Read AGENTS.md, inspect the source documents, and guide me through the next step.

```sh
verid doctor
verid menu
```

For an existing codebase in `remix` mode, run `verid stock` before agent changes.

### Start with modular documents and repo resources

```sh
verid cook --mode prep --resources repo --provider codex --yes
node .verid/verid.mjs module identity
```

Fill the module drafts, then publish the agreed requirements, design and ACs in
`.verid/spec.md`, `.verid/design.md` and `.verid/plan.md`. Cook does not prefill
these approval inputs with placeholder content.

For Codex, trust the project and the generated hooks through `/hooks`, then run
`verid doctor`. See [Codex setup](#codex-setup).

---

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

The [modular cook guide](docs/modular-cook.md) has the complete template and execution flow.

---

## Repository layouts

### One Git repository

```text
your-project/                  # .git/
├── src/
├── test/
├── .verid/
├── AGENTS.md
├── CLAUDE.md                  # when Claude Code is selected
├── .claude/
├── .agents/                   # Codex skill entries with repo resources
└── .codex/
```

Commit the project documents and generated shared instructions with the source code.

### Multiple repositories in one workspace

```text
workspace/                     # no .git/ at this level
├── api/                       # .git/
├── web/                       # .git/
├── .verid/                    # shared harness repository, its own .git/
├── AGENTS.md                  # regenerated per machine
├── CLAUDE.md                  # regenerated per machine, when selected
├── .claude/
├── .agents/
└── .codex/
```

Each manifest repo has its own paths, globs and runner. The workspace shares one TDD
cycle. Run cook and open the provider at the workspace root so it can see every repo.

Workspace-root `AGENTS.md` and `CLAUDE.md` are per machine; `verid cook` regenerates them.

### What lives in .verid?

The following tree shows `modular` with `repo` resources. Provider-specific files
are created only for the selected providers; module files appear after `verid module`.

```text
.verid/
├── manifest.yaml
├── verid.mjs                   # local CLI launcher; run with node
├── workflow.md
├── constitution.md
├── architecture-profile.md
├── ownership.yaml
├── docs/                      # source documents; agents only read
├── research.md                # written after research
├── spec.md                    # agreed requirements, with unique IDs
├── design.md                  # agreed architecture and interfaces
├── plan.md                    # executable module ACs
├── agents/                    # includes the Codex reviewer TOML
├── skills/                    # scripts, references and licenses included
├── templates/
├── hooks/                     # bundled CLI, hook and runtime dependencies
├── i18n/
├── policies/
├── rules/
├── approvals/                 # human-readable decisions
├── artifacts/
│   ├── 00-baseline/
│   ├── 01-research/
│   ├── 02-discovery/
│   ├── 03-modules/<module>/
│   │   ├── ba/
│   │   ├── ui/
│   │   ├── spec/
│   │   ├── tests/
│   │   ├── security/
│   │   ├── review/
│   │   └── release/
│   ├── 04-plans/
│   ├── 05-implementation/
│   ├── 06-evaluation/
│   ├── 07-release/
│   └── adr/
├── log/<module>.md            # main appends one entry per AC
├── review/work.md             # generated review snapshot
└── .state/                    # runtime approvals, test evidence and audit; ignored
```

Commit templates, repo resources, source documents, dossiers and agreed project
documents. In a monorepo also commit `AGENTS.md`, `CLAUDE.md` when present, and native
agent/skill entries. Codex's repo reviewer config is `.codex/config.toml`.

Keep `.verid/.state/` out of Git. `.codex/hooks.json` and
`.claude/settings.local.json` are wiring for each machine. The `approvals/` folder
contains decision records; actual verid approvals remain in private runtime state.

---

## Commands

In repo mode, run each command as `node .verid/verid.mjs <command>` from the
project root. The `verid` shorthand below also works with an optional global install.

| Command                                | Purpose                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `verid cook`                           | Preview and set up a project, or wire a cloned project for this machine.      |
| `verid upgrade [--dry-run] [--yes]`    | Refresh provider wiring and instructions and offer missing manifest defaults. |
| `verid module <name>`                  | Create a modular dossier from project templates.                              |
| `verid doctor`                         | Check setup, providers, resources and audit findings.                         |
| `verid menu`                           | Show module progress and the next step.                                       |
| `verid peek`                           | Show the current TDD state.                                                   |
| `verid stock`                          | Record pre-existing failures for remix.                                       |
| `verid taste`                          | Run tests and record evidence.                                                |
| `verid order [module]`                 | Approve a module in human drive; sign or resume auto drive.                   |
| `verid serve <module>`                 | Close a module when coverage, fresh evidence and reviews pass.                |
| `verid menu --commits --file`          | Produce the review packet.                                                    |
| `verid garnish`                        | Start a refactor-only session.                                                |
| `verid halt [reason]` / `verid resume` | Pause agent tool use or resume it.                                            |
| `verid setup-codex`                    | Set up the installed reviewer in the Codex user config.                       |
| `verid setup-antigravity`              | Install or update verid's Antigravity plugin for this user.                   |

Cook, upgrade, stock, order, serve, garnish, halt and resume are developer commands,
run in your own terminal. Agents use taste, menu, peek and doctor. In signed auto
drive, the harness manages module order and closure.

### Cook flags

```sh
verid cook --mode prep --resources repo --provider codex --lang en --yes
```

| Flag                                         | Values or effect                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `--mode`                                     | `prep`, `recipe` or `remix`.                                              |
| `--resources`                                | `installed` or `repo`.                                                    |
| `--provider`                                 | `claude-code`, `codex` or `antigravity`; repeat for several.              |
| `--drive`                                    | `human` or `ai` for prep/recipe (`auto` remains an alias).                |
| `--architecture`                             | `ddd`, `clean`, `layered` or `none`.                                      |
| `--layout`                                   | `monorepo` or `workspace`; otherwise detected.                            |
| `--lang`                                     | `en` or `vi`; this machine's CLI language.                                |
| `--test-cmd`                                 | Custom command containing `{junit}` or `VERID_JUNIT`.                     |
| `--src` / `--tests`                          | Repeatable source and test globs.                                         |
| `--iterations`                               | Enable calendar planning; supply duration, start date and demo day below. |
| `--duration` / `--start-date` / `--demo-day` | For example `"2 weeks"`, `2026-11-09`, `Sunday`.                          |
| `--dry-run`                                  | Show the plan without writing.                                            |
| `--yes`                                      | Accept suggested defaults and skip confirmation.                          |

Interactive iteration planning uses 14 days and puts the demo on the last day.
Iteration metadata does not change AC order or TDD gates.

When a manifest exists, its configuration takes precedence over setup flags. The
developer edits it to change choices, then runs cook again. For a switch to repo
resources, also change Claude role names from `verid:<name>` to `verid-<name>`.
The Codex reviewer name stays `verid_reviewer`.

### Preview before writing

```sh
verid cook --mode prep --resources repo --provider codex --dry-run
```

The preview shows a file tree: `+` creates, `~` updates, `=` keeps, and `!` introduces
a note. Confirmation applies the checked plan. Existing instruction text outside
`<!-- verid:begin -->` and `<!-- verid:end -->` stays intact.

---

## How a module moves through the workflow

| Step           | Owner and output                                                               |
| -------------- | ------------------------------------------------------------------------------ |
| Research       | Main with BA reads `.verid/docs/` and records scope and sources.               |
| Spec           | Main with BA writes traceable requirements in `.verid/spec.md`.                |
| Design         | Architect, or Codex main, agrees interfaces and reuse in `.verid/design.md`.   |
| Plan           | Planner, or Codex main, writes ordered ACs in `.verid/plan.md`.                |
| Order          | Developer approves the module; auto drive follows its signed plan.             |
| Build and test | Tester/QA then coder on Claude; main on Codex; every cycle uses `verid taste`. |
| Review         | Fresh reviewers inspect ACs, design, dossier, diff and the review packet.      |
| Serve          | Evidence, AC coverage and verdicts must pass before closure.                   |
| Handoff        | Main prepares the commits and PR after the agreed product checks.              |

This table is a summary. The full steps are in `.verid/workflow.md`.

### Modes and drive

| Mode     | Starting point          | First work                                 |
| -------- | ----------------------- | ------------------------------------------ |
| `prep`   | An idea                 | Research, clarification, spec and design.  |
| `recipe` | Existing specifications | Validate the inputs, then design and plan. |
| `remix`  | Existing code           | Record the baseline with `verid stock`.    |

`human` leaves order and serve to the developer. `auto` starts when the developer
signs research, spec and design with `verid order`. It reviews the plan and works
module by module. Questions that block progress go into `.verid/blocked.md`; the
developer resolves them and resumes with `verid order`.

### TDD and evidence

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

---

## Agents, skills and provider integration

`AGENTS.md` is the shared instruction source. `CLAUDE.md` imports it through
`@AGENTS.md`. Hooks check tool calls independently of the prose instructions.

| Work                   | Skill                       | Writer/reviewer                     |
| ---------------------- | --------------------------- | ----------------------------------- |
| Orientation            | `onboard`                   | Main; reads and reports.            |
| Research and spec      | `ba`                        | Main.                               |
| Module dossiers        | `modules`                   | Main, using repo templates.         |
| Architecture           | `design`                    | Mapped architect, or Codex main.    |
| Module plan            | `plan`                      | Mapped planner, or Codex main.      |
| TDD and implementation | `build`, `tdd`, `debugging` | Tester/QA and coder, or Codex main. |
| Evaluation             | `review`, `security`        | Independent read-only reviewers.    |

With installed Claude resources, names use `verid:<name>`. For example:

```sh
claude plugin marketplace add anhtranhai835/verid
claude plugin install verid@verid
```

Repo resources use `verid-<name>` entries under `.claude/skills/` and
`.claude/agents/`. They route to `.verid/skills/` and `.verid/agents/`. Codex
discovers local skill entries under `.agents/skills/`.

The onboard skill inventories repos and runners, reports health and gives the next
step. It proposes manifest changes for the developer to apply.

### Codex setup

For a project with repo resources:

1. Run cook with `--provider codex --resources repo`.
2. Open Codex at the project or workspace root.
3. Trust the project and each generated verid hook through `/hooks`.
4. Run `verid doctor` and resolve setup findings.
5. Let main write tests/code; use `verid_reviewer` with `fork_turns: "none"` for review.

Cook adds a project `.codex/config.toml` whose reviewer points at
`../.verid/agents/verid-reviewer.toml`. That overlay reads repo skills and uses a
read-only sandbox. Repo mode does not write the Codex user's config.

For `resources: installed`, cook sets up the user reviewer and uses installed skill
paths. Trust remains a user action in either mode.

The repo hook has an integration test for Codex order, RED/GREEN, read-only review
and invalidation after a module spec change. An offline check with Codex CLI
`0.166.0` also confirmed that its model-visible input includes the project
instructions and repo skills. See the [validation notes](docs/modular-cook.md#dùng-với-codex).

### Antigravity setup

1. Run `verid setup-antigravity` once per machine, and again after each verid update.
   It installs verid's plugin in `~/.gemini/config/plugins/verid/`. Restart Antigravity.
2. Run cook with `--provider antigravity` (add `--provider claude-code` for both).
3. Run `verid doctor` and resolve setup findings.
4. Let main write tests/code; dispatch `verid-reviewer` (and `verid-security`) with
   `invoke_subagent` for review. Type `/verid peek`, `/verid tip` and `/verid confirm`
   in the chat.

verid's core reads Antigravity's hook payloads itself, so the same rules, TDD gate and
review binding apply as on Claude Code and Codex. The payload shapes are not yet checked
against recorded Antigravity fixtures. See [the integration notes](docs/antigravity-integration.vi.md).

### Protection and audit

The hook protects runtime state, secrets, provider definitions, hook bundles and
instruction blocks. It checks module approval, the TDD cycle and writer roles.
Supported Codex calls include `apply_patch`, shell actions and reviewer dispatch.

Spec coverage, dependency order, architecture conventions and known dispatch lists
also produce advisory findings. The conventions in `.verid/rules/architecture.md` and
configured `architecture_check` results are advisory; doctor and menu report their findings.
Read the complete [hook rule reference](docs/hook-reference.md)
for rule codes and override behaviour. A one-call exception requires an attended
developer in Claude Code.

---

## Manifest example

This example uses the modular workflow, repo resources and Codex:

```yaml
schemaVersion: 1
mode: prep
resources: repo
providers: [codex]
architecture: ddd
layout: monorepo
drive: human
allowed_skills: []
allowed_agents: []
roles:
  reviewer: [verid_reviewer]
repos:
  - path: .
    source_globs: ["**"]
    test_globs: ["**/test/**", "**/*.test.*"]
    ignore_globs: ["**/*.md", "**/*.json", "**/*.yaml", ".verid/**", ".agents/**", ".codex/**"]
```

Cook generates fuller defaults for detected runners and file conventions. Test globs
take priority over ignored files and source globs. A custom runner must write JUnit
to `{junit}` or the `VERID_JUNIT` environment path. Only the developer edits the manifest.

For external skills, `allowed_skills: ["superpowers:*"]` adds a known namespace;
`allowed_agents` adds exact agent names. Mapped `roles` and the TDD gate still decide
writes. The retired `roles.researcher` is replaced by `verid:ba` in the main thread
(`verid-ba` with repo resources).

---

## Working with a teammate

After cloning a project with repo resources, run `node .verid/verid.mjs cook --yes`
at the project or workspace root. The committed CLI is ready to run with Node.js.
For installed resources, install the CLI and run `verid cook` instead.
Existing manifest choices and repo resource copies are retained;
cook restores missing setup files and rewires hooks for the current machine.

In a multi-repo workspace, share the `.verid` repository. Cook can clone missing
manifest repos from their configured remotes. Commit native entries and
instructions in the source repo for monorepos; regenerate workspace-root entries
on each machine.

## Upgrading

For repo resources, `node .verid/verid.mjs cook --yes` rewires the committed version
for the current machine. To change that pinned version, review and update the repo's
runtime and resource copies. An optional global installation can be upgraded with:

```sh
npm install -g @anhtranhai835/verid
verid upgrade --dry-run
verid upgrade --yes
verid doctor
```

For a source install, update the checkout, build it and reinstall it first.
Upgrade refreshes provider wiring and instructions and adds accepted missing
defaults. Existing repo resources and module documents are preserved. Refresh
pinned resources by reviewing their changes and replacing the intended copies.

---

## Development

```sh
npm ci
npm run typecheck
npx prettier --check .
npm test
npm run test:full
```

Windows [CI](.github/workflows/ci.yml) runs typecheck, formatting and the full suite,
including installer tests. `npm test` omits the installer end-to-end suite.

## Credits

verid's bundled workflows draw on
[superpowers](https://github.com/obra/superpowers) and
[andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills).
See each bundled skill's license for attribution.

## License

MIT. See [LICENSE](LICENSE).

## Upgrading from 1.x

This is version 2.0.0. Legacy manifests with `workflow: classic`, `workflow: modular`, `workflow: kanban` or no workflow still load; `--workflow` is a compatibility flag. `auto` remains an alias of drive `ai`.

Run `verid upgrade --dry-run`, then `verid upgrade --yes`. Upgrade removes the retired workflow, adds templates/artifact directories, and drafts dossiers and Artifacts references for unserved modules. Complete those inputs and order again; open human tasks require a fresh session. Served sections, approvals and evidence stay intact. Run `verid doctor` to find remaining gaps.

With repo resources, update the pinned runtime in `.verid/hooks/` and relevant resources after upgrading the package; upgrade preserves existing customizations. Before downgrading to 1.x, remove `kanban.queue` from state in the developer's terminal.
