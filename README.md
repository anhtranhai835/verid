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
evidence and checks approvals; hooks refuse writes that skip an approval or a failing test.

---

## Why use verid?

- **Plan by module.** Each module has testable ACs; the developer decides when work can start.
- **Use recorded evidence.** `verid taste` checks the runner exit code and JUnit report.
- **Keep roles focused.** Tests, code and review are separate roles, and reviewers only read.
- **Carry the workflow with the repo.** Agents, skills, templates and a pinned hook runtime can live in the project.
- **Resume from facts.** `verid menu` shows module progress, audit findings and the next step.

---

## Quick start

Needs Node.js 22 or later, Git, and Claude Code or Codex. Other ways to install, and Codex and Antigravity setup, are in [installation](docs/installation.md).

To try verid on a small project first, follow [examples/slugify](examples/slugify/README.md).

**1. Install.**

```sh
npm install -g @anhtranhai835/verid
```

**2. Set the project up.** Press Enter at each question: the language, the mode (`prep` for an idea, `recipe` for existing specs, `remix` for existing code) and, for prep and recipe, the drive (`big-brain`: you pick and approve each task; `no-brain`: you type the idea and the agent does the rest). Cook shows the provider, layout and test runner it found and the files it will write; "Change settings" changes the rest.

```sh
cd your-project
verid cook
```

Its last line is the sentence to say: `Open Claude Code and say: what's next?`. In a `remix` project the line above asks you to run `verid stock` first.

**3. Say "what's next?".** Open Claude Code or Codex at the project root and say it. The agent checks the setup (as `verid doctor` does) and names the next step; then describe your idea. It works through `ba`, `design` and `plan`; `verid menu` shows where it stands.

**4. Approve a module.** Read the module the agent wrote in `.verid/plan.md`. When the ACs are right, order it.

```sh
verid order <module>
```

**5. Watch it build.** The agent writes a failing test, then code, with `verid taste` between. The cycle goes RAW, COOKING, PLATED.

```sh
verid peek
```

**6. Review and serve.** A fresh reviewer checks the module. When evidence and reviews pass, close it.

```sh
verid serve <module>
```

**Blocked?** Every refusal prints a code and the next step; see [troubleshooting](docs/troubleshooting.md).

---

## How a module moves through the workflow

| Step           | Owner and output                                                               |
| -------------- | ------------------------------------------------------------------------------ |
| Research       | Main with BA reads `.verid/docs/` and records scope and sources.               |
| Spec           | Main with BA writes traceable requirements in `.verid/spec.md`.                |
| Design         | Architect, or Codex main, agrees interfaces and reuse in `.verid/design.md`.   |
| Plan           | Planner, or Codex main, writes ordered ACs in `.verid/plan.md`.                |
| Order          | Developer approves the module; no-brain drive follows its signed plan.         |
| Build and test | Tester/QA then coder on Claude; main on Codex; every cycle uses `verid taste`. |
| Review         | Fresh reviewers inspect ACs, design, dossier, diff and the review packet.      |
| Serve          | Evidence, AC coverage and verdicts must pass before closure.                   |
| Handoff        | Main prepares the commits and PR after the agreed product checks.              |

This table is a summary. The full steps are in `.verid/workflow.md`. For a small change, see [small changes](docs/small-changes.md).

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
| `verid doctor --ci`                    | Check, in CI, what the repo holds: spec-to-AC trace, plan order, setup files. |
| `verid menu`                           | Show module progress and the next step.                                       |
| `verid peek`                           | Show the current TDD state.                                                   |
| `verid stock`                          | Record pre-existing failures for remix.                                       |
| `verid taste`                          | Run tests and record evidence.                                                |
| `verid order [module]`                 | Approve a module in big-brain drive; sign or resume no-brain drive.           |
| `verid serve <module>`                 | Close a module when coverage, fresh evidence and reviews pass.                |
| `verid menu --commits --file`          | Produce the review packet.                                                    |
| `verid garnish`                        | Start a refactor-only session.                                                |
| `verid halt [reason]` / `verid resume` | Pause agent tool use or resume it.                                            |
| `verid setup-codex`                    | Set up the installed reviewer in the Codex user config.                       |
| `verid setup-antigravity`              | Install or update verid's Antigravity plugin for this user.                   |

Cook, upgrade, stock, order, serve, garnish, halt and resume are developer commands,
run in your own terminal. Agents use taste, menu, peek and doctor. In signed no-brain
drive, the harness manages module order and closure. Cook flags are in the [cook reference](docs/cook-reference.md).

---

## Repository layouts

One Git repository:

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

Multiple repositories in one workspace:

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

Commit the project documents and generated shared instructions with the source code.
In a workspace, run cook and open the provider at the workspace root; each manifest repo
has its own paths, globs and runner, and the workspace shares one TDD cycle.
Workspace-root `AGENTS.md` and `CLAUDE.md` are per machine; `verid cook` regenerates them.
The full `.verid/` tree is in [providers and protection](docs/providers-and-protection.md).

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
drive: big-brain
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

## Protection

The hook protects runtime state, secrets, provider definitions, hook bundles and
instruction blocks, and checks module approval, the TDD cycle and writer roles.
The conventions in `.verid/rules/architecture.md` and configured `architecture_check`
results are advisory: doctor and menu report them. Rule codes and override behaviour
are in the [hook rule reference](docs/hook-reference.md).

## Docs

- [Install and set up](docs/installation.md): install options, Codex and Antigravity setup, upgrading, migrating from 1.x.
- [Cook reference](docs/cook-reference.md): flags, preview, modes and drive.
- [Modules and board](docs/modules-and-board.md): dossiers, the browser board, TDD states.
- [Providers and protection](docs/providers-and-protection.md): agents and skills, the `.verid/` tree, working with a teammate.
- [Troubleshooting](docs/troubleshooting.md): the refusals you meet first.
- [Small changes](docs/small-changes.md) · [Board workflow](docs/kanban-workflow.md) · [Modular cook guide](docs/modular-cook.md) · [CI gate](docs/ci-gate.md)

## Development

```sh
npm ci
npm run typecheck
npx prettier --check .
npm test
npm run test:coverage
```

[CI](.github/workflows/ci.yml): typecheck, format, all tests with coverage floors on Windows per PR;
on `main` and releases also Ubuntu (Node 22, 24) and macOS. `npm test` omits installer tests.

## Credits

verid's bundled workflows draw on
[superpowers](https://github.com/obra/superpowers) and
[andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills).
See each bundled skill's license for attribution.

## License

Private, for internal use only; not licensed for redistribution. Bundled skills keep their own licenses.
