# Providers and protection

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

## Protection and audit

The hook protects runtime state, secrets, provider definitions, hook bundles and
instruction blocks. It checks module approval, the TDD cycle and writer roles.
Supported Codex calls include `apply_patch`, shell actions and reviewer dispatch.

Spec coverage, dependency order, architecture conventions and known dispatch lists
also produce advisory findings. The conventions in `.verid/rules/architecture.md` and
configured `architecture_check` results are advisory; doctor and menu report their findings.
Read the complete [hook rule reference](hook-reference.md)
for rule codes and override behaviour. A one-call exception requires an attended
developer in Claude Code.

## What lives in .verid?

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
