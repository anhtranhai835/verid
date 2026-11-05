```
 ██╗   ██╗ ███████╗ ██████╗  ██╗ ██████╗
 ██║   ██║ ██╔════╝ ██╔══██╗ ██║ ██╔══██╗
 ██║   ██║ █████╗   ██████╔╝ ██║ ██║  ██║
 ╚██╗ ██╔╝ ██╔══╝   ██╔══██╗ ██║ ██║  ██║
  ╚████╔╝  ███████╗ ██║  ██║ ██║ ██████╔╝
   ╚═══╝   ╚══════╝ ╚═╝  ╚═╝ ╚═╝ ╚═════╝
     hook-enforced TDD for Claude Code and Codex · RAW → COOKING → PLATED
```

# verid: TDD for Claude Code and Codex

**English** · [Tiếng Việt](README.vi.md)

verid gives coding agents a test-first workflow backed by hooks.
It records test evidence before allowing implementation and keeps an audit trail.
The developer approves modules, exceptions and the final handoff.

## Install

Requires Node.js 22+ and Claude Code or Codex CLI.

Windows: `irm https://raw.githubusercontent.com/anhtranhai835/verid/main/install.ps1 | iex` (PowerShell). macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/anhtranhai835/verid/main/install.sh | sh`.

Or install with `npm install -g @anhtranhai835/verid`. For Claude Code, add the `anhtranhai835/verid` marketplace and install `verid@verid`. After an upgrade or moving an installation, run `verid upgrade --yes` in each project.

## Quick start

Run `verid cook` in the project; choose provider, language, mode, architecture and drive. Put source documents in `.verid/docs/`. In remix, run `verid stock` before the agent changes code. Open the provider and ask for the work; `verid menu` shows the next step.

Commit `.verid/manifest.yaml`, `.verid/.gitignore`, `.verid/rules/`, `.verid/docs/`, `.verid/log/`, `AGENTS.md`, `CLAUDE.md` when present, and the research, spec, design and plan documents in prep or recipe. Keep `.claude/settings.local.json` and `.codex/hooks.json` per machine.

## From pantry to plate (Workflow)

Gather ingredients (Research) → Write recipe (Spec) → Sketch dish (Design) → Set menu (Plan) → Place order (Order) → Cook and taste (Build and Test) → Inspect dish (Review) → Serve dish (Serve) → Hand off (Commit, push, PR). After each served dish, place the order for the next module.

| Kitchen step                    | Owner                                 | Result                                                                                                        |
| :------------------------------ | :------------------------------------ | :------------------------------------------------------------------------------------------------------------ |
| Gather ingredients (Research)   | main, `verid:ba`                      | Read source documents in `.verid/docs/`; record scope in `.verid/research.md`.                                |
| Write recipe (Spec)             | main, `verid:ba`                      | Write sourced requirements in `.verid/spec.md`.                                                               |
| Sketch dish (Design)            | architect                             | Agree interfaces and dependencies in `.verid/design.md`.                                                      |
| Set menu (Plan)                 | planner                               | Write ordered modules and testable ACs in `.verid/plan.md`.                                                   |
| Place order (Order)             | developer in human drive              | `verid order <module>` approves one module. Auto opens modules in file order; `Depends:` names prerequisites. |
| Cook and taste (Build and Test) | tester or QA, then coder              | Fail an AC assertion, implement, pass `verid taste`, refactor; main logs the AC in `.verid/log/<module>.md`.  |
| Inspect dish (Review)           | reviewer, then security when mapped   | Read `verid menu --commits --file`; end each report with `Verdict: pass` or `Verdict: fail`.                  |
| Serve dish (Serve)              | developer in human drive; auto closes | `verid serve <module>` requires covered ACs, current passing evidence and reviews.                            |
| Hand off (Handoff)              | main                                  | After `product`, commit, push and open a PR.                                                                  |

## Cooking cycle (TDD)

The hook decides writes by file path and role. `verid taste` runs the configured suite, checks its exit code against JUnit, and records the cycle; an ad hoc test run is diagnostic only.

| State      | Test writes             | Production writes                  | Taste result                                                                                        |
| :--------- | :---------------------- | :--------------------------------- | :-------------------------------------------------------------------------------------------------- |
| RAW        | allowed                 | blocked                            | A new assertion failure enters COOKING; a test that cannot load opens RAW · stub; a pass stays RAW. |
| RAW · stub | allowed                 | only a stub to reach the assertion | An assertion enters COOKING; a pass returns to RAW.                                                 |
| COOKING    | frozen                  | minimum implementation             | A failure stays COOKING; a pass enters PLATED.                                                      |
| PLATED     | allowed and reopens RAW | refactor only                      | A failure returns to COOKING; a pass stays PLATED.                                                  |

Name each test with its AC code. The main conversation reads agent reports and appends one dated entry per AC to `.verid/log/<module>.md`; agents do not write that log. A test write reopens RAW, and only a fresh assertion failure in RAW opens implementation. A new conversation starts RAW; `verid garnish` opens a refactor-only conversation.

`Stop` holds the main thread on COOKING, an open stub or unverified writes; in human drive it also holds once per conversation for uncovered ACs or pending review. `SubagentStop` lets tester/QA hand a recorded failing test or stub to coder, but holds writers whose latest change lacks a taste run. Each hold is issued once; auto drive also manages its own progress holds.

## Modes and drive

| Mode     | Start         | Work                                                              |
| :------- | :------------ | :---------------------------------------------------------------- |
| `prep`   | idea          | research, spec, design, plan, modules                             |
| `recipe` | specification | design, plan, modules                                             |
| `remix`  | existing code | `verid stock` records old failures; build uses the same TDD cycle |

`drive: human` leaves order and serve to the developer. `drive: auto` signs research, spec and design once, reviews the plan, then orders and serves modules in file order; blockers go to `.verid/blocked.md`, and the developer resumes with `verid order`. Optional iterations guide scheduling without changing gates.

## Providers

`AGENTS.md` is the shared instruction source; `CLAUDE.md` imports it with `@AGENTS.md`. `verid cook` and `verid upgrade` maintain the marked block in `AGENTS.md`; `verid doctor` checks both files. The hook enforces rules independently of these instructions.

Claude Code can split tester, coder, QA, reviewer and security through `roles`. Codex uses one main writer for tests and code and a read-only `verid_reviewer`; trust the project and its hooks in `/hooks` before work. Only an attended developer on Claude Code can grant a one-action exception with `/verid tip`.

## Layouts

`monorepo` has one Git tree. A `workspace` has multiple child repositories and a shared `.verid/` repo; each repo has its own globs and runner but all share one TDD cycle. Workspace `CLAUDE.md` and `AGENTS.md` sit at the workspace root, per machine; `verid cook` regenerates them after cloning.

## Conventions and audit

- **Spec and dependencies:** ACs cite REQ/NFR/SEC IDs; `Depends:` shows module prerequisites. Unknown or uncovered IDs and dependency order are warnings.
- **Architecture and screens:** `.verid/rules/architecture.md`, other project rules and `architecture_check` are advisory. A module's `Screens:` wireframe guides e2e tests and review.
- **Session log and review:** Main appends decisions, evidence, deviations and next AC to `.verid/log/<module>.md`. The review packet `.verid/review/work.md` is a snapshot; regenerate it after fixes.
- **Git:** `.verid/rules/git.md` describes Conventional Commits and PR handoff. Git audits warn; commits do not gate module closure.

## Commands

| Command                                        | Use                                                                     |
| :--------------------------------------------- | :---------------------------------------------------------------------- |
| `verid cook`, `verid upgrade`                  | Set up or refresh project hooks and instructions.                       |
| `verid doctor`, `verid menu`, `verid peek`     | Check installation and audit, next workflow step, or current cycle.     |
| `verid stock`, `verid taste`                   | Record remix baseline or run tests as evidence.                         |
| `verid order [module]`, `verid serve <module>` | Developer approval and closure in human drive; order also resumes auto. |
| `verid garnish`, `verid halt`, `verid resume`  | Refactor-only session, emergency halt, or resume.                       |
| `verid menu --commits --file`                  | Write the review snapshot.                                              |

## What the hook blocks

| Rule                                 | Overridable        | Covers                                                                                                                                                                                                                                                                                                               |
| :----------------------------------- | :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERID_BURNT_STATE_PROTECTED`        | no                 | reading or writing `.verid/.state/`, writing `.verid/review/`, or overwriting the `.verid/` root                                                                                                                                                                                                                     |
| `VERID_BURNT_HALTED`                 | no                 | any tool call while the developer has run `verid halt`                                                                                                                                                                                                                                                               |
| `VERID_BURNT_SECRET_PROTECTED`       | no                 | secret files: `.env*` (not templates), keys, certificates, `.ssh/`, `.npmrc`…                                                                                                                                                                                                                                        |
| `VERID_BURNT_TRANSCRIPT_PROTECTED`   | no                 | Claude Code transcripts in `~/.claude/projects/` or `CLAUDE_CONFIG_DIR/projects/`                                                                                                                                                                                                                                    |
| `VERID_BURNT_HOOK_PROTECTED`         | no                 | writing project/home `.claude/settings*.json`, any `.claude.json` or `.mcp.json` (MCP server lists), `.claude/agents/`, `.claude/plugins/`, project `.claude/skills/` / `~/.claude/skills/` and `.claude/commands/` / `~/.claude/commands/`, the same paths under `CLAUDE_CONFIG_DIR`, verid's `dist/` and `plugin/` |
| `VERID_BURNT_MANIFEST_PROTECTED`     | yes                | writing `.verid/manifest.yaml`                                                                                                                                                                                                                                                                                       |
| `VERID_BURNT_DOCS_PROTECTED`         | yes                | writing in `.verid/docs/`, the developer's documents                                                                                                                                                                                                                                                                 |
| `VERID_BURNT_INSTRUCTIONS_PROTECTED` | yes                | changing or removing the verid block in a provider's instruction file                                                                                                                                                                                                                                                |
| `VERID_BURNT_PATCH_UNSUPPORTED`      | no on Codex        | malformed or unknown `apply_patch` syntax, including environment routing, or a patch handed to the shell                                                                                                                                                                                                             |
| `VERID_BURNT_TOOL_UNSUPPORTED`       | no on Codex        | a non-MCP Codex tool outside the supported list; the message names it                                                                                                                                                                                                                                                |
| `VERID_BURNT_AGENT_CONTEXT`          | no on Codex        | reviewer dispatch with `fork_turns` other than `"none"`                                                                                                                                                                                                                                                              |
| `VERID_BURNT_BASH_NESTED_CODEX`      | yes in Claude Code | a shell starting a nested `codex`                                                                                                                                                                                                                                                                                    |
| `VERID_BURNT_BASH_NESTED_CLAUDE`     | yes                | Bash starting a nested `claude`                                                                                                                                                                                                                                                                                      |
| `VERID_BURNT_BASH_DEVELOPER_ONLY`    | yes                | Bash naming `CLAUDECODE` or verid's hook, or running a developer command                                                                                                                                                                                                                                             |
| `VERID_BURNT_BASH_DANGEROUS`         | yes                | downloading or decoding code and running it in one command (`curl …                                                                                                                                                                                                                                                  | sh`, `bash <(curl …)`, `irm … | iex`, `base64 -d | sh`, `powershell -enc`), `git --no-verify`or`core.hooksPath`, `sudo`, `doas`, RunAs, and `chmod` setuid/setgid |
| `VERID_BURNT_SHELL_UNSUPPORTED`      | yes in Claude Code | Claude Code's unsupported shells, or Codex dynamic PowerShell forms whose command cannot be read                                                                                                                                                                                                                     |
| `VERID_BURNT_ROLE_READ_ONLY`         | yes                | any write by the mapped reviewer or security reviewer                                                                                                                                                                                                                                                                |
| `VERID_BURNT_ROLE_TESTER_ONLY`       | yes                | split: a test written by anyone but the tester (or qa, for end-to-end tests)                                                                                                                                                                                                                                         |
| `VERID_BURNT_ROLE_CODER_ONLY`        | yes                | split: production code written by anyone but the coder                                                                                                                                                                                                                                                               |
| `VERID_BURNT_PLAN_NOT_APPROVED`      | yes                | production code while no module is open (prep, recipe)                                                                                                                                                                                                                                                               |
| `VERID_BURNT_AUTO_NO_MODULE`         | yes                | auto: production code while no module is open                                                                                                                                                                                                                                                                        |
| `VERID_BURNT_AUTO_STUCK`             | yes                | auto: production code and tests while the drive is stuck                                                                                                                                                                                                                                                             |
| `VERID_BURNT_TDD_NO_FAILING_TEST`    | yes                | production code while the cycle is RAW                                                                                                                                                                                                                                                                               |
| `VERID_BURNT_TDD_TEST_FROZEN`        | yes                | a test while the cycle is COOKING                                                                                                                                                                                                                                                                                    |
| `VERID_BURNT_GIT_INTERNALS`          | no                 | any write inside a repository's `.git` folder: refs, configuration, hooks                                                                                                                                                                                                                                            |

The rules cover file tools, Bash (its plain write targets are judged like a Write), MCP tools, Claude Code's `Skill`, `Agent` and `Task`, and Codex's `apply_patch` and `collaborationspawn_agent`. Codex also protects project/home `.codex/`, project/home `.agents/skills/` and verid's `plugin/` folder, treats `~/.codex/sessions/`, `history.jsonl` and its state databases as transcripts and `~/.codex/auth.json` as a secret, including a relocated `CODEX_HOME`. Unexpected errors inside verid block the call.

Roles: with a tester and a coder mapped, only the coder writes production code and only the tester (or qa, for end-to-end tests) writes tests; main and unknown agents cannot take either permission. Reviewer and security write nothing. The scope of the drafting roles (architect, planner, qa) and the known skill/agent lists are advisory: departures are audited, not blocked. A role needs the host's subagent identity.

## manifest.yaml

```yaml
schemaVersion: 1
mode: prep # prep | recipe | remix
providers: [claude-code, codex]
drive: human # human | auto
layout: monorepo # monorepo | workspace
allowed_skills: []
allowed_agents: []
roles:
  reviewer: ["verid:reviewer", "verid_reviewer"]
  tester: ["verid:tester"]
  coder: ["verid:coder"]
repos:
  - path: .
    source_globs: ["**"]
    test_globs: ["**/test/**", "**/*.test.*"]
```

Test globs take priority over ignore and source globs. The developer edits the manifest; `verid cook` supplies defaults. Optional `allowed_skills: ["superpowers:*"]` and `allowed_agents` extend dispatch; mapped `roles` and the TDD gate still decide writes. The retired `roles.researcher` is replaced by `verid:ba` in main.

## Development

`npm run typecheck`, `npx prettier --check .`, `npm test`; Windows CI also runs `npm run test:full` in [ci.yml](.github/workflows/ci.yml).

## Credits

verid draws on [superpowers](https://github.com/obra/superpowers) and [andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills). See the bundled skill licenses for attribution.

## License

MIT. See [LICENSE](LICENSE).
