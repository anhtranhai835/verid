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

> The agent does the work. verid verifies it. The developer approves.

## Why

Coding agents in a hurry skip the test: they write the code first, or weaken a test until it goes green. A prompt can ask for TDD; a hook can refuse the write. verid supports Claude Code and Codex, holding the agent to the RED → GREEN → REFACTOR cycle of the [superpowers](https://github.com/obra/superpowers) `test-driven-development` skill, named RAW → COOKING → PLATED. verid fails closed internally; Codex's host failure and trust limits are listed below. Only the developer can open an exception in Claude Code, and a hash-chained audit log records it. Your project gains `.verid/`, a short block in each selected provider's instruction file, Claude Code's `.claude/commands/verid/` and per-machine `.claude/settings.local.json`, or Codex's per-machine `.codex/hooks.json`.

## Requirements

- Node.js 22 or later, and [Claude Code](https://claude.com/claude-code) or Codex CLI (tested with 0.164.0).
- The superpowers plugin, whose skills verid points the agent at.
- The andrej-karpathy-skills plugin, whose `karpathy-guidelines` skill verid calls.
- The verid plugin: researcher, architect, planner, tester, coder, qa, reviewer and security agents that `verid cook` maps to the roles, a skill for each step, `verid:security` (STRIDE + OWASP review of a module's diff) and `verid:edge-cases` (an AC's edge cases before its tests). Any other agent can fill a role through `roles`; researcher, architect, planner, qa and security are optional. Claude Code auto needs reviewer, tester and coder; Codex-only auto needs the reviewer.

```bash
claude plugin marketplace add obra/superpowers-marketplace
claude plugin install superpowers@superpowers-marketplace
claude plugin marketplace add forrestchang/andrej-karpathy-skills
claude plugin install andrej-karpathy-skills@karpathy-skills
claude plugin marketplace add anhtranhai835/verid
claude plugin install verid@verid
```

## Install

Windows (PowerShell 5.1+):

```powershell
irm https://raw.githubusercontent.com/anhtranhai835/verid/main/install.ps1 | iex
```

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/anhtranhai835/verid/main/install.sh | sh
```

The installers require Node 22+, install verid with npm, and add all three plugins when `claude` is on PATH. With a terminal and `CI` empty, `false` or `0`, they ask for a project folder and run `verid cook`; an empty answer finishes without choosing a folder. They refuse the home folder. Otherwise they print the next step.

Set `VERID_VERSION` to pin a release (default: `latest`): `$env:VERID_VERSION = '1.1.0'` before the PowerShell command, or `curl -fsSL https://raw.githubusercontent.com/anhtranhai835/verid/main/install.sh | VERID_VERSION=1.1.0 sh`. Clear the PowerShell pin afterwards with `Remove-Item Env:VERID_VERSION`.

Or install directly:

```bash
npm install -g @anhtranhai835/verid
```

From a clone: `npm ci`, `npm run build`, `npm link` (or the `bun install --frozen-lockfile`, `bun run build`, `bun link` equivalents). The hooks point at the installed `dist/`, so run `verid upgrade --yes` in each project after upgrading, moving the clone, or switching between npm and a clone.

## Quick start

In your own terminal, in the project to guard:

```bash
verid cook     # pick providers, language, mode and, in prep and recipe, drive
verid stock    # remix only: record the tests that already fail
```

Then open your selected provider and say what you want. For Codex, complete the trust step below first. Every verid message names the next command; `verid menu` says where the project stands.

In a monorepo, commit `.verid/manifest.yaml`, `.verid/.gitignore`, the selected providers' instruction files (`CLAUDE.md` / `AGENTS.md`), `.claude/commands/verid/` when using Claude Code and, in prep and recipe, `.verid/research.md`, `.verid/design.md` and `.verid/plan.md`. Keep `.claude/settings.local.json` and `.codex/hooks.json` local: they name this machine's verid. A teammate runs `verid cook` once after cloning. Workspace files are described below.

## Providers and Codex

`providers` defaults to `[claude-code]`, including older manifests. Choose providers during `verid cook`, or repeat `--provider`: `verid cook --provider claude-code --provider codex --mode prep --yes`. For an existing project, edit `providers` in `.verid/manifest.yaml`, then run `verid upgrade --yes`.

Cook and upgrade create or refresh only the block between `<!-- verid:begin -->` and `<!-- verid:end -->` in `CLAUDE.md` for Claude Code and `AGENTS.md` for Codex. They preserve all other content and never copy skills or agents into the project. The block points to the workflow, commands, state and allowlists; `verid doctor` reports missing or edited blocks. Agent writes may change the rest of the file while preserving the block.

Selecting Codex writes `.codex/hooks.json` for PreToolUse, UserPromptSubmit, Stop, SubagentStop and SessionStart, with this install's hook path and explicit timeouts. It also merges a marked `[agents.verid_reviewer]` block into `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`), pointing at the reviewer overlay shipped with verid. Other TOML stays unchanged; no agent or skill is copied into your project. The `AGENTS.md` block names this install's absolute skill paths for each step, such as `plugin/skills/review/SKILL.md`.

In your own terminal, run `verid cook --provider codex --mode prep --yes`, then open Codex in the project, trust the project and use `/hooks` to review and trust every verid hook. Run `verid doctor` to check the wiring, project trust, hook trust entries, reviewer definition and Codex version. After upgrading or moving verid, run `verid upgrade --yes`, review the changed hooks again in `/hooks`, then run doctor. Setup never writes a trust bypass.

On Codex the main agent writes both tests and code under the same TDD gate; tester/coder splitting is off regardless of Claude Code role mappings. Dispatch `verid_reviewer` with `fork_turns: "none"` and only the module's ACs, `.verid/design.md` path and diff. Its final SubagentStop message records the review; the reviewer is read-only and ends with `Verdict: pass` or `Verdict: fail`. Skill allowlists are advisory on Codex because skill activation has no hookable call. `/verid tip` and `/verid confirm` have no effect there: exceptions require Claude Code. Use `verid peek` and `verid menu` in the terminal.

Codex PreToolUse denials use JSON with exit 0, and Stop holds use `decision: "block"`. PowerShell commands labeled `Bash` meet all existing Bash rules plus PowerShell write-target checks; every target of the `apply_patch` tool meets path, role and TDD rules. A patch handed to the shell (`apply_patch <<'EOF'`, the `.exe`/`.bat`/`.cmd` program, any `*** Begin Patch` text) is denied, because Codex applies it from a `workdir` or `cd` the hook never sees. The supported tools are `Bash`, `apply_patch`, `collaborationspawn_agent`, `collaborationwait_agent`, `update_plan`, `Read`, `Grep`, `Glob` and MCP tools (`mcp__*`); other tools, malformed patches and unsupported dynamic shell forms are denied. The Codex gaps are listed under Limitations.

## Layouts

`monorepo` is the default: one project tree, with repo paths relative to its root. A `workspace` is a folder without its own `.git`, containing separate repos:

```text
project/ (.git)              workspace/ (no .git)
├── api/                    ├── api/ (.git)
├── web/                    ├── web/ (.git)
├── .verid/                 ├── .verid/ (.git)
└── .claude/                └── .claude/ (per machine)
```

Cook detects a workspace when the folder is outside a git work tree (or its ancestor repo is rooted at the user's home folder for dotfiles in `~`) and has at least one direct child repo. `--layout monorepo|workspace` chooses explicitly for a new manifest; an existing manifest keeps its layout. Workspace setup, whether explicit, detected or read from a manifest, is refused inside any other ancestor git repo. Home comes from Node's `os.homedir()` (`USERPROFILE` on Windows, not Git's `HOME`). The workspace must have no `.git` of its own; only child repos are discovered. The preview shows the layout, and cook initializes `.verid/` as a git repo without committing. Commit shared files inside `.verid/`; root `.claude/` files are generated on each machine. Open Claude Code at the workspace root.

Workspace `CLAUDE.md` / `AGENTS.md` live at the workspace root, outside the shared `.verid` repo. They are per machine; `verid cook` regenerates their verid blocks while preserving user text.

Cook records each child's origin after removing userinfo (including passwords and tokens); only the conventional passwordless SSH user `git@` is kept, in SSH URLs and scp-style remotes. `default_branch` comes only from local `origin/HEAD`; without it the field stays unset.

A teammate clones the shared repo as `workspace/.verid`, then runs `verid cook` **from `workspace/`**. The preview, including `--dry-run`, lists each clone as `path <- remote (branch)` when a branch is set. Git inherits the terminal and SSH settings, can prompt, and has no clone timeout. Clones allow only `https`, `ssh`, `git` and local `file` transport; network file shares (UNC, `//host/...`, hosted `file://` URLs) and remotes starting with `-` are refused.

Cook keeps existing folders, continues after clone failures, and exits 1 if any failed or a remote is missing. Before cloning, it writes a per-repo marker under protected `.verid/.state/clones/` and removes it after success or once a failed clone's destination is confirmed gone. Failed clones remove only the destination created by that call; re-run to retry missing folders, clearing any stale marker first. An existing marked folder is accepted and its marker cleared when `HEAD` resolves to a commit, a checkout is present and its index matches `HEAD` (`git diff --cached --quiet HEAD`). Otherwise it is an incomplete clone, including after Ctrl-C: preserve any work, finish the checkout or remove that folder and re-run `verid cook`. Fresh repos without commits are valid, so a new prep workspace sets up with exit 0; unmarked existing repos print "already set up". `--dry-run` previews clones and `.verid` initialization without writing.

Hook globs and taste run relative to each listed repo. qa can write paths in any repo's `e2e_globs`; the build skill chooses `role: frontend` by default, or a designated `role: e2e` repo. All repos share one TDD cycle. Auto checks every listed repo and the `.verid` repo for a clean tree and records git presence per repo at signing; losing git after signing keeps that repo dirty. Doctor reports each repo and `.verid` too.

## Modes

| Mode     | Starts from             | verid adds                                                                                                                                                                        |
| :------- | :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prep`   | an idea, no code yet    | research in `.verid/research.md`, a design in `.verid/design.md`, then modules in `.verid/plan.md`, each approved, reviewed and served, last a `product` module of end-to-end ACs |
| `recipe` | a specification         | the same steps, with modules taken from the specification                                                                                                                         |
| `remix`  | existing code and tests | a baseline of the tests that failed before verid                                                                                                                                  |

In prep and recipe, optional `iterations` in the manifest groups the plan by calendar windows. A module may have one `Iteration: 1` line as the first nonempty line after its heading, including `product`; the line stays optional with iterations on and must be a positive integer. Every later line is ordinary text. With iterations off, no `Iteration:` line is parsed, so existing plans and running drives keep their behaviour. The planner fits modules into the configured duration and asks the developer when the work will not fit.

`verid menu` and the session-start message show the current iteration and its dates, the countdown to its last demo weekday, this iteration's modules served/total and unserved modules of past iterations marked late. The demo shows `today` on its date and `demo passed` afterwards; a window with no matching weekday uses its end date. Windows start at `start_date`, last the configured number of calendar days and include their end date; before the start, iteration 1 and its demo are shown. Today is the machine's local date.

## Drive: human or auto

In prep and recipe, `drive` in the manifest says who moves the project from module to module; `verid cook` asks after the mode.

| Drive             | Who moves the project                                                                                                                                                               |
| :---------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `human` (default) | the developer: `verid order <module>` opens each module, `verid serve <module>` closes it                                                                                           |
| `auto`            | the agent: it plans, builds and reviews every module, `product` last, and stops only when stuck. Claude Code needs reviewer, tester and coder in `roles`; Codex-only needs reviewer |

The auto drive:

1. **Ask.** The agent asks the research and design questions and writes `.verid/research.md` and `.verid/design.md`. Until they are signed, production code is locked and the drive does not hold the agent (the usual holds for a red test, a stub or an unrun change still apply).
2. **Sign.** The developer reads both and runs `verid order` (no module) in their own terminal; verid records their sha256. Unless the drive gets stuck, this is the only command the developer types.
3. **Plan.** The agent writes `.verid/plan.md`, ending with `product`, and the reviewer reviews it against the design. A review ends with `Verdict: pass` or `Verdict: fail`; no such line counts as fail. Production code stays locked until the plan passes.
4. **Build.** verid opens the first module not yet served, in plan order. On Claude Code, the tester (qa for `(e2e)` ACs when mapped) and coder build each AC test-first; on Codex, the main agent does both. The agent commits the module on `feat/<module>`, the reviewer reviews it, then the security reviewer when `roles.security` is mapped. Branches are a skill instruction; the hook's clean-tree check is unchanged.
5. **Close.** verid closes the module once every AC has a passing test, the last run passed with no change since, every configured architecture check passed on the files as they are, the review after the last change says pass (and the security review too, when mapped), and git is clean: the project subtree and listed repos in monorepo, every listed repo and `.verid` in workspace (untracked files count, `.claude/settings.local.json` does not). The next module opens; the drive is done when `product` closes last, and a module served after `product` reopens it.

Stop holds the agent every time, saying what comes next, until the drive is done or stuck. `verid menu` and the session-start message show the drive (signed, plan reviewed, modules, counters n/3, next step or why it is stuck); `verid peek` shows the cycle and the next step.

**Limits.** Every loop stops at 3: failed plan reviews, coder rounds per AC (a round ends when the coder stops with a red test naming the AC), failed module reviews, failed security reviews (a count of their own), and Stop holds in a row with no progress (tests, plan, commits and counters unchanged). A count resets when its loop passes; the no-progress count, when the outcome changes.

**Stuck** when `.verid/blocked.md` has text (written by the agent when only the developer can answer, or by the developer to pause), a limit is reached, `.verid/research.md` or `.verid/design.md` differs from what was signed, or a served module's plan section was edited or removed. The first time a hook sees `.verid/blocked.md` (any Stop, or any tool call that writes, a Bash `rm` of it included), verid latches the block in `.verid/.state/`, so deleting the file does not clear it; a count at its limit also stays until `verid order`. The last two causes are re-read from the files, so restoring them clears the block. While stuck, production code and tests are locked (`VERID_BURNT_AUTO_STUCK`) and Stop lets the agent stop and tells the developer why, as when done.

**Resume** with `verid order`: it signs again, resets the counts, deletes `.verid/blocked.md` and drops the open module's review. The plan stays approved only if research and design did not change; a served module whose plan section changed is reopened, and one the plan dropped is forgotten.

**Refusals.** With no module open, production code is locked (`VERID_BURNT_AUTO_NO_MODULE`). In auto, `verid order <module>` and `verid serve` refuse (`VERID_BURNT_AUTO_ORDER_MODULE`, `VERID_BURNT_AUTO_SERVE`), and `verid order` refuses while research or design is missing (`VERID_BURNT_RESEARCH_MISSING`, `VERID_BURNT_DESIGN_MISSING`).

**Esc and switching.** Press Esc to ask the agent something: Stop does not run on an interrupt, and holds the agent again after it answers. To switch drive, edit `drive:` in `.verid/manifest.yaml`. Served modules stay served; human to auto needs the signing and a plan review; auto to human needs `verid order <module>` for the open module.

## Architecture

In prep and recipe, `.verid/design.md` holds a design table that the architect proposes and the developer agrees:

```markdown
| Repo | Bounded context / owner | Layer       | Paths                         | Public interface                   | May depend on                   |
| ---- | ----------------------- | ----------- | ----------------------------- | ---------------------------------- | ------------------------------- |
| api  | ordering / orders team  | domain      | `src/ordering/domain/**`      | aggregate operations, domain ports | domain only                     |
| api  | ordering / orders team  | application | `src/ordering/application/**` | place-order use case               | ordering domain                 |
| api  | ordering / orders team  | adapters    | `src/ordering/adapters/**`    | HTTP and persistence adapters      | ordering application and domain |
```

Beside it the design agrees the APIs between contexts, forbidden edges and cycles, shared and generated code, test exceptions, the framework annotation policy (Spring or JPA in the domain) and how existing code adopts the rules. Bounded contexts, layers and plan modules stay distinct, and no interface per class is required. The table is part of the file `verid order` signs: an edited cell locks production code until the next order, and leaves an auto drive stuck. In remix nothing signs it; the agreement is written in the file.

The planner maps modules to rows and interfaces in plain prose; the coder keeps to the allowed edges; the tester tests at the agreed interface; qa tests journeys across context APIs and never writes analyzer configuration; the build skill gives every mapped agent, other plugins' included, the rows its AC touches. The reviewer always reads the real imports for forbidden edges, domain-to-infrastructure coupling, context API breaches and cycles, and judges SOLID and DDD whatever a tool says.

A repo can also run a checker the project owns. It is opt-in, and `verid cook` and `verid upgrade` never add it:

```yaml
repos:
  - path: .
    architecture_check:
      command: npm run architecture
      inputs: [".dependency-cruiser.cjs", "tsconfig.json", "package.json", "package-lock.json"]
      timeout_sec: 100 # optional; the repo's timeout by default
```

`command` runs through the shell in the repo's root. `inputs` are repo-relative globs, each matching at least one file, for the checker's rules and config, resolver, build and lock files and local wrappers; they count even where `ignore_globs` frees them. verid installs, bundles and configures no tool:

| Project            | Project-owned check                                                                                                                                                                                                                                         |
| :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spring Boot / Java | [ArchUnit](https://www.archunit.org/userguide/html/000_Index.html) tests run by the Maven or Gradle task that compiles the current classes (`mvn -q test -Dtest=ArchitectureTest`): packages and layers, context edges and cycles, agreed annotation rules  |
| TypeScript         | [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) `forbidden` rules with the tsconfig resolver for aliases, re-exports and type imports (`npx depcruise src --config .dependency-cruiser.cjs`); blocking rules must make it exit nonzero |
| Python             | [Import Linter](https://import-linter.readthedocs.io/en/stable/contract_types/) layers, independence and forbidden contracts over declared root packages (`lint-imports`)                                                                                   |

After a passing suite, `verid taste` runs each configured check and records its result in `.verid/.state/`, with the log under the run. Exit 0 passes; another exit fails (`VERID_BURNT_ARCHITECTURE_FAILED`); a command that cannot start or times out, a file it reads (code, a test or an input) that cannot be read or links outside the repo, or an input that matches nothing, gives no evidence (`VERID_BURNT_ARCHITECTURE_UNAVAILABLE`). Either makes taste exit 2, while the test run still moves the cycle. A check gives no AC coverage and never runs in `verid stock`, a hook or doctor. Remix runs configured checks too, with no module to close.

A pass holds for a snapshot: the repo's code and test files and the declared inputs (added and deleted files included), the check's settings and the repo's globs, the design and the open module's approval. It is recorded only when the snapshot and the TDD revision did not change during the run, and every gate recomputes the snapshot, so any change since needs another taste (`VERID_BURNT_ARCHITECTURE_STALE`). `verid serve` and the auto drive, at a Stop or right after the reviewer's pass, close a module only when every configured repo passed on its current snapshot; `verid menu` names the repo to fix or rerun. A workspace's `.verid` is not a checked repo. Doctor names each configured check, marked not executed. Missing, stale or failed evidence is a problem only while a module waits to close, and a note otherwise; an input or file the check cannot read is always a problem.

## Commands

| Command                             | Who                       | What it does                                                                                                                                                                                                                                                                  |
| :---------------------------------- | :------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verid cook [--dry-run] [--yes]`    | developer                 | previews setup for this project and machine; offers an older manifest its new defaults                                                                                                                                                                                        |
| `verid upgrade [--dry-run] [--yes]` | developer                 | adds missing manifest defaults, regenerates verid's commands and refreshes this machine's hook paths                                                                                                                                                                          |
| `verid doctor`                      | anyone                    | checks Node, repos, uncommitted changes, `default_branch` when set, runners, hooks, provider instruction blocks, installed plugins, the verid agents the roles map and the evidence of configured architecture checks, which it never runs; read-only, exits 1 on problems    |
| `verid taste`                       | agent                     | runs the tests, then after a passing suite each configured architecture check; only these runs count as evidence                                                                                                                                                              |
| `verid peek`                        | anyone                    | the cycle, the next step, and why the last run did not count                                                                                                                                                                                                                  |
| `verid menu`                        | anyone                    | research, modules with their AC coverage, open questions, the next step                                                                                                                                                                                                       |
| `verid stock`                       | developer                 | remix: records the failing tests as the baseline                                                                                                                                                                                                                              |
| `verid order [module]`              | developer                 | prep, recipe: approves a module of `.verid/plan.md`, signing `.verid/design.md` too; auto: signs research and design, and resumes after a stop                                                                                                                                |
| `verid serve <module>`              | developer                 | prep, recipe, human drive only: closes the open module once every AC passes, every configured architecture check passed on the current files and the reviewer reviewed it after the last change (and the security reviewer passed it, when mapped); prints the reviews' paths |
| `verid garnish`                     | developer                 | opens production code for a conversation that only refactors                                                                                                                                                                                                                  |
| `/verid:tip <reason>`               | developer, in Claude Code | asks to let the action just blocked through, with a one-time code                                                                                                                                                                                                             |
| `/verid:confirm <code>`             | developer, in Claude Code | lets that exact action through once                                                                                                                                                                                                                                           |
| `/verid:peek`, `/verid:menu`        | developer, in Claude Code | what `verid peek` and `verid menu` show, to you only                                                                                                                                                                                                                          |

`verid cook` takes repeatable `--provider claude-code|codex`, `--mode prep|recipe|remix`, `--drive human|auto`, `--layout monorepo|workspace`, `--lang vi|en`, `--test-cmd` (your own test command) and repeatable `--src`/`--tests` globs, and asks when given none in a terminal. In prep or recipe, add `--iterations --duration "2 weeks" --start-date 2026-10-12 --demo-day Friday`, supplying all three settings; the interactive flow asks after drive. Once a manifest exists, `--provider`, `--mode`, `--drive`, `--layout`, `--iterations`, `--duration`, `--start-date`, `--demo-day`, `--test-cmd`, `--src` and `--tests` are ignored with a note: edit `.verid/manifest.yaml` by hand. The developer's commands refuse inside Claude Code and recognized Codex tool shells; the hook also blocks recognizable developer calls.

Cook and upgrade show a file tree before writing: `+` create, `~` modify, `=` keep, `!` advisory. In a terminal, confirm with `Apply? (Y/n)`; if files change while it waits, verid shows the new plan and asks again. `--dry-run` writes nothing; `--yes` skips prompts, applies the fresh plan and accepts defaults, including a suggested mode for a new project (prep, or remix when src/, lib/ or app/ exists). A new project's `--dry-run` also uses that suggestion unless `--mode` is set. Without a terminal, cook still works with an explicit mode or an existing manifest; upgrade requires `--yes` to write. Upgrade replaces local edits to the four generated verid commands; cook keeps them.

## Plugins

Workflow plugins connect tools to verid through Node scripts. They are separate from the Claude Code plugins that supply skills and agents. Every source is unofficial and runs with your user permissions; review it before accepting. All `verid plugin` commands belong to the developer and refuse inside Claude Code and recognized Codex tool shells.

```sh
verid plugin add ./my-plugin --yes       # also file:../my-plugin
verid plugin add git:https://example.com/team/plugin.git#v1 --yes
verid plugin add npm:@team/verid-board@1.0.0 --yes
verid plugin list                       # plugin doctor checks scripts and required tools
verid plugin run taste                  # sample JSON, with sample: true
verid plugin remove board               # keeps its data
```

Add shows the name, version, events, required commands and source, then asks to install; `--yes` accepts. Without a terminal, `--yes` is required. There is no registry, setup command or automatic tool installation. Commit `.verid/plugins.json` (an array of `{ "name", "source", "resolved" }`) and `.verid/plugin-data/<name>/`. Fetched code and staging copies stay in `.verid/plugins/`, ignored by `.verid/.gitignore`. Cook and upgrade restore missing or changed code with the same confirmation; `--dry-run` only previews. Git restores the recorded commit and npm the recorded version. Git uses the workspace clone restrictions and inherited terminal; userinfo is stripped before fetching or storing a remote.

Developer add, remove and confirmed restores record SHA-256 approvals in `.verid/.state/plugin-integrity.json`: the exact bytes of `plugins.json` and every plugin file's relative path and content, sorted by path. Only the plugin's own folder is hashed; dependencies resolved from outside it are not. The agent cannot read or write that state through file tools or recognised MCP paths. Before every script, including `plugin run` and hook events, verid compares the files with those approvals. A missing record or mismatch skips execution, writes an audit warning and asks the developer to review and re-approve with `verid plugin add` (remove the installed copy first), or restore with `verid cook` / `verid upgrade`. `verid plugin doctor` reports mismatches. Adding or removing another plugin preserves existing approvals rather than approving changed code.

A plugin folder contains `verid-plugin.json` and its scripts:

```json
{ "name": "board", "version": "1.0.0", "events": { "taste": "taste.mjs" }, "requires": ["node"] }
```

The manifest accepts only these fields: a portable kebab-case name, a version, known events with relative script paths, and optional command names on PATH. Paths cannot be absolute, contain `..` or pass through links. Scripts run with Node in the fetched plugin folder, receive JSON on stdin and get an absolute `VERID_PLUGIN_DATA` directory. For example, `taste.mjs`:

```js
import fs from "node:fs";
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
fs.appendFileSync(`${process.env.VERID_PLUGIN_DATA}/events.jsonl`, raw + "\n");
```

Events are `module-opened` and `module-served` (`module`), `taste` (`passed`, `counts: { passed, failed, skipped }` for a valid run), `drive-stuck` (`reason`) and `drive-done`. Every payload has `event`; `plugin run` sends a sample. Auto transitions are observed after Stop or SubagentStop saves its decision. Script output is ignored; failures, crashes and timeouts become audit entries and warnings, preserving verid's decision. Delivery shares five seconds per CLI event, or one second across all events and plugins in a hook.

File tools and recognised MCP writers cannot change plugin sources, fetched code **or data**, even with `/verid tip`. Bash naming those plugin paths or calling `verid plugin`, including versioned npm entry points and an optional `--` separator, has the same non-overridable protection. Data can select commands or configure a tool, so it is protected from those writes too. The developer and plugin scripts can update it; data is outside the content approval.

## How it works

### Three rules

1. **No production code without a failing test first.** Production code is locked while the cycle is RAW, and in prep and recipe while no module is approved. While a test fails, the tests are frozen.
2. **Evidence before claims.** Only a `verid taste` run whose exit code and JUnit report agree counts. In the human drive the agent cannot stop while the last run fails or after a change no run has seen; the auto drive holds every Stop itself.
3. **Only the developer opens an exception.** In Claude Code, `/verid tip` works only with a person at the keyboard, never from a subagent or `claude -p`. Each exception lets one action past one rule, once: a command two rules block needs two. Codex cannot create overrides.

### Roles

Claude Code puts an `agent_type` in each subagent's tool calls; `roles` maps agent types to roles. With both a tester and a coder, the work is split. Codex uses a main writer and a read-only reviewer, with no tester/coder split:

| Who writes                                   | Production code    | Tests                                               | Other files (docs, config, `.verid/*.md`) |
| :------------------------------------------- | :----------------- | :-------------------------------------------------- | :---------------------------------------- |
| the reviewer                                 | `ROLE_READ_ONLY`   | `ROLE_READ_ONLY`                                    | `ROLE_READ_ONLY`                          |
| the security reviewer                        | `ROLE_READ_ONLY`   | `ROLE_READ_ONLY`                                    | `ROLE_READ_ONLY`                          |
| the researcher                               | `ROLE_DOC_ONLY`    | `ROLE_DOC_ONLY`                                     | only `.verid/research.md`                 |
| the architect                                | `ROLE_DOC_ONLY`    | `ROLE_DOC_ONLY`                                     | only `.verid/design.md`                   |
| the planner                                  | `ROLE_DOC_ONLY`    | `ROLE_DOC_ONLY`                                     | only `.verid/plan.md`                     |
| qa                                           | `ROLE_QA_E2E_ONLY` | e2e by the TDD gate; other tests `ROLE_QA_E2E_ONLY` | `ROLE_QA_E2E_ONLY`                        |
| split: the coder                             | by the TDD gate    | `ROLE_TESTER_ONLY`                                  | allowed                                   |
| split: the tester                            | `ROLE_CODER_ONLY`  | by the TDD gate                                     | allowed                                   |
| split: the main conversation, other agents   | `ROLE_CODER_ONLY`  | `ROLE_TESTER_ONLY`                                  | allowed                                   |
| not split: main, tester, coder, other agents | by the TDD gate    | by the TDD gate                                     | allowed                                   |

- A call with no `agent_id` is the main conversation, even under `claude --agent X`. Role rules come before the TDD gate: the role says who, the cycle says when.
- When the reviewer stops with a module open, verid records its final report under `.verid/.state/reviews/`; a later code or test write, or a new `verid order`, voids it. The security reviewer's report is recorded the same way, and voided by the same events and by any later write in the project outside `.verid/` (dependency, config and `.env` files included); when `roles.security` is mapped, a module closes only on its `Verdict: pass`, in the human drive and the auto drive.
- A subagent that wrote code or a test is held once if it stops while a test fails, a stub is open or a change is unrun; the split tester and qa are not held for a failing test or a stub.
- qa and the tester can both write end-to-end tests in split mode. For every writer, only paths matching `e2e_globs` count as end-to-end tests at the write gate, including Playwright tests; these still meet the TDD gate.
- `verid:design` dispatches the mapped researcher then architect, and `verid:plan` the mapped planner. The main conversation presents their proposals and relays questions one at a time before asking them to write. Unmapped steps stay in the main conversation. `verid:build` suggests `feat/<module>` for each module.

### The cycle

| State             | Production code    | Tests           | `verid taste` fails                                                           | `verid taste` passes |
| :---------------- | :----------------- | :-------------- | :---------------------------------------------------------------------------- | :------------------- |
| RAW (RED)         | locked             | writable        | → COOKING on a new assertion failure; → RAW · stub on a test that cannot load | stays RAW            |
| RAW · stub (RED)  | open, for the stub | writable        | → COOKING on an assertion failure; stays while a test cannot load             | → RAW                |
| COOKING (GREEN)   | open               | frozen          | stays COOKING                                                                 | → PLATED             |
| PLATED (REFACTOR) | open               | writable, → RAW | → COOKING                                                                     | stays PLATED         |

- Only a failure the previous run did not have moves the cycle. A new conversation starts in RAW; `verid garnish` opens a refactor-only one.
- In prep and recipe, put the AC code in the name of the test that covers it: `AC-1 adds two numbers`, or `AC_1_addsTwoNumbers` where a name cannot hold a dash.
- In remix, baseline tests are known failures outside the cycle; one that passes leaves the baseline for good.

## What the hook blocks

| Rule                                 | Overridable        | Covers                                                                                                                                                                                                                                                         |
| :----------------------------------- | :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERID_BURNT_STATE_PROTECTED`        | no                 | reading or writing `.verid/.state/`                                                                                                                                                                                                                            |
| `VERID_BURNT_SECRET_PROTECTED`       | no                 | secret files: `.env*` (not templates), keys, certificates, `.ssh/`, `.npmrc`…                                                                                                                                                                                  |
| `VERID_BURNT_TRANSCRIPT_PROTECTED`   | no                 | Claude Code transcripts in `~/.claude/projects/` or `CLAUDE_CONFIG_DIR/projects/`                                                                                                                                                                              |
| `VERID_BURNT_HOOK_PROTECTED`         | no                 | writing project/home `.claude/settings*.json`, `.claude/agents/`, `.claude/plugins/`, project `.claude/skills/` / `~/.claude/skills/` and `.claude/commands/` / `~/.claude/commands/`, the same paths under `CLAUDE_CONFIG_DIR`, verid's `dist/` and `plugin/` |
| `VERID_BURNT_PLUGIN_PROTECTED`       | no                 | file-tool/MCP writes to `.verid/plugins.json`, `.verid/plugins/`, `.verid/plugin-data/` or `.verid/` itself; Bash naming plugin paths or calling `verid plugin`                                                                                                |
| `VERID_BURNT_MANIFEST_PROTECTED`     | yes                | writing `.verid/manifest.yaml`                                                                                                                                                                                                                                 |
| `VERID_BURNT_INSTRUCTIONS_PROTECTED` | yes                | changing or removing the verid block in a provider's instruction file                                                                                                                                                                                          |
| `VERID_BURNT_SKILL_NOT_ALLOWED`      | yes                | a `Skill` call outside `verid:*`, `superpowers:*`, `andrej-karpathy-skills:*` and `allowed_skills`                                                                                                                                                             |
| `VERID_BURNT_AGENT_NOT_ALLOWED`      | yes in Claude Code | `Agent` / `Task` or Codex `collaborationspawn_agent` dispatch to a type absent from `roles` and `allowed_agents`                                                                                                                                               |
| `VERID_BURNT_PATCH_UNSUPPORTED`      | no on Codex        | malformed or unknown `apply_patch` syntax, including environment routing, or a patch handed to the shell                                                                                                                                                       |
| `VERID_BURNT_TOOL_UNSUPPORTED`       | no on Codex        | a non-MCP Codex tool outside the supported list; the message names it                                                                                                                                                                                          |
| `VERID_BURNT_AGENT_CONTEXT`          | no on Codex        | reviewer dispatch with `fork_turns` other than `"none"`                                                                                                                                                                                                        |
| `VERID_BURNT_BASH_NESTED_CODEX`      | yes in Claude Code | a shell starting a nested `codex`                                                                                                                                                                                                                              |
| `VERID_BURNT_BASH_NESTED_CLAUDE`     | yes                | Bash starting a nested `claude`                                                                                                                                                                                                                                |
| `VERID_BURNT_BASH_DEVELOPER_ONLY`    | yes                | Bash naming `CLAUDECODE` or verid's hook, or running a developer command                                                                                                                                                                                       |
| `VERID_BURNT_SHELL_UNSUPPORTED`      | yes in Claude Code | Claude Code's unsupported shells, or Codex dynamic PowerShell forms whose command cannot be read                                                                                                                                                               |
| `VERID_BURNT_ROLE_READ_ONLY`         | yes                | any write by the mapped reviewer or security reviewer                                                                                                                                                                                                          |
| `VERID_BURNT_ROLE_TESTER_ONLY`       | yes                | split: a test written by anyone but the tester (or qa, for end-to-end tests)                                                                                                                                                                                   |
| `VERID_BURNT_ROLE_CODER_ONLY`        | yes                | split: production code written by anyone but the coder                                                                                                                                                                                                         |
| `VERID_BURNT_ROLE_DOC_ONLY`          | yes                | researcher, architect or planner writing outside its own document; the message names the allowed file                                                                                                                                                          |
| `VERID_BURNT_ROLE_QA_E2E_ONLY`       | yes                | qa writing production code, unit tests or any file outside end-to-end tests                                                                                                                                                                                    |
| `VERID_BURNT_PLAN_NO_RESEARCH`       | yes                | writing `.verid/plan.md` before `.verid/research.md` exists                                                                                                                                                                                                    |
| `VERID_BURNT_PLAN_NO_DESIGN`         | yes                | writing `.verid/plan.md` before `.verid/design.md` exists                                                                                                                                                                                                      |
| `VERID_BURNT_PLAN_NOT_APPROVED`      | yes                | production code while no module is open (prep, recipe)                                                                                                                                                                                                         |
| `VERID_BURNT_AUTO_NO_MODULE`         | yes                | auto: production code while no module is open                                                                                                                                                                                                                  |
| `VERID_BURNT_AUTO_STUCK`             | yes                | auto: production code and tests while the drive is stuck                                                                                                                                                                                                       |
| `VERID_BURNT_TDD_NO_FAILING_TEST`    | yes                | production code while the cycle is RAW                                                                                                                                                                                                                         |
| `VERID_BURNT_TDD_TEST_FROZEN`        | yes                | a test while the cycle is COOKING                                                                                                                                                                                                                              |

The rules cover file tools, Bash (its plain write targets are judged like a Write), MCP tools, Claude Code's `Skill`, `Agent` and `Task`, and Codex's `apply_patch` and `collaborationspawn_agent`. Codex also protects project/home `.codex/`, project/home `.agents/skills/` and verid's `plugin/` folder (the skills the `AGENTS.md` block names, and the reviewer template), treats `~/.codex/sessions/`, `history.jsonl` and its state databases as transcripts and `~/.codex/auth.json` as a secret, including a relocated `CODEX_HOME`. Denial messages name the allowlist. In Claude Code, a developer's `/verid tip` override permits one exact call for one overridable rule; other rules still apply. Codex has no overrides. Unexpected errors inside verid block the call.

## manifest.yaml

```yaml
schemaVersion: 1
mode: remix # prep | recipe | remix
providers: [claude-code] # optional: claude-code, codex; defaults to [claude-code]
allowed_skills: [] # optional additions: exact names or prefix:*
allowed_agents: ["general-purpose"] # cook default; exact agent types
roles: # optional: agent types, as Claude Code reports them, for each role
  reviewer: ["verid:reviewer"]
  tester: ["verid:tester"] # with both a tester and a coder, the work is split
  coder: ["verid:coder"]
  researcher: ["verid:researcher"] # optional: only .verid/research.md
  architect: ["verid:architect"] # optional: only .verid/design.md
  planner: ["verid:planner"] # optional: only .verid/plan.md
  qa: ["verid:qa"] # optional: only end-to-end tests
  security: ["verid:security"] # optional: a module closes only on its Verdict: pass
drive: human # human | auto
layout: monorepo # monorepo | workspace; defaults to monorepo when absent
# iterations: { duration: "2 weeks", start_date: "2026-10-12", demo_day: Friday } # prep, recipe only
repos:
  - path: .
    # remote: https://example.com/team/api.git  # optional: clone a missing repo
    # default_branch: main  # optional: verid doctor checks it
    # role: backend  # optional: frontend | backend | e2e | other
    # test_cmd: make test JUNIT={junit}   # optional: without it verid finds the runners
    source_globs: ["**"] # production code
    test_globs: ["**/test/**", "**/*.test.*", …] # tests and runner config
    ignore_globs: ["**/*.md", "**/*.json", …] # never production code
    e2e_globs: ["**/e2e/**", "**/*.e2e.*"] # end-to-end tests
    timeout_sec: 100 # optional
    # architecture_check: { command: "npm run architecture", inputs: [".dependency-cruiser.cjs"] } # optional, see Architecture
```

- Only the developer edits the manifest; `verid cook` writes the defaults, where every file is code unless it is a test, a document, data, config, a build file or a tool's folder.
- `providers` is a nonempty list of `claude-code` and/or `codex`; upgrade adds `[claude-code]` to older manifests. Missing `allowed_skills` and `allowed_agents` default to `[]`. Skills always allow `verid:*`, `superpowers:*` and `andrej-karpathy-skills:*`; `allowed_skills` adds exact names such as `team:lint` or namespace patterns such as `team:*`. Agent dispatch allows the exact types in `roles` plus `allowed_agents`, for every caller. Adding an agent does not give it a mapped role or bypass write rules.
- Cook writes `allowed_agents: ["general-purpose"]` because the superpowers skills it calls dispatch that type; upgrade offers it when the field is missing and keeps existing values. Removing it denies those dispatches unless `general-purpose` is mapped in `roles`. Role rules and the TDD gate still apply to it.
- `iterations` is optional in prep and recipe: `duration` is a positive integer followed by `day`, `days`, `week` or `weeks`, `start_date` is a real `YYYY-MM-DD` date, and `demo_day` is `Monday` through `Sunday` (case-sensitive).
- Repo paths are relative to the project, distinct and non-overlapping; `./x`, `x/` and repeated separators are normalized. Workspace paths name child folders. Absolute paths, parent traversal, Windows aliases and linked workspace repo roots are refused; monorepo project and repo folders may be links. Each repo has its own globs, command and timeout; workspace test names and remembered runners include the repo path so names in different repos stay distinct. `remote`, `default_branch` and `role` are optional.
- A name in `roles` has one role, and a tester needs a coder on Claude Code. Without `roles`, nobody is held to a role and `verid serve` refuses for want of a reviewer. `drive: auto` needs prep or recipe and reviewer, tester and coder for Claude Code, or only reviewer for Codex-only projects; researcher, architect, planner, qa and security are optional. Cook offers missing optional defaults in older mappings, adds `verid_reviewer` to `roles.reviewer` when Codex is selected, and keeps existing names. A Codex-only project maps no `security`: its one reviewer also checks security with `verid:security`.
- A path matching `test_globs` or `e2e_globs` is a test; else one matching `ignore_globs` is free; else one matching `source_globs` is code. Globs support `**`, `*`, `?`; a folder is `src/**`.
- An AC written `- AC-3 (e2e): …` needs a passing end-to-end test: any test Playwright reports, or another runner's test whose file matches `e2e_globs`.

Without `test_cmd`, verid finds the runners from the build files in the repo root and its top-level folders:

| Build file                                    | verid runs                                   | If the report is missing, the agent runs                    |
| :-------------------------------------------- | :------------------------------------------- | :---------------------------------------------------------- |
| `package.json` with vitest, or jest           | `npx --no vitest run` / `npx --no jest --ci` | `npm install` / `npm install -D jest-junit`                 |
| `playwright.config.*`, or `@playwright/test`  | `npx --no playwright test`                   | `npm install -D @playwright/test && npx playwright install` |
| `pytest.ini`, `conftest.py`, `pyproject.toml` | `python -m pytest`                           | `python -m pip install pytest`                              |
| `pom.xml`, `build.gradle(.kts)`               | `mvn -B -ntp test`, `gradlew test --rerun`   | —                                                           |
| `*.sln`, `*.csproj`                           | `dotnet test`                                | `dotnet add <project> package JunitXml.TestLogger`          |
| `go.mod`                                      | `gotestsum ./...`                            | `go install gotest.tools/gotestsum@latest`                  |
| `phpunit.xml`, phpunit in `composer.json`     | `php vendor/bin/phpunit`                     | `composer require --dev phpunit/phpunit`                    |
| `.rspec`, rspec in the `Gemfile`              | `bundle exec rspec`                          | `bundle add rspec_junit_formatter --group test`             |

- Playwright beside vitest or jest: each picks up the other's files by default, so set `testDir: "e2e"` in playwright.config and exclude `e2e/**` in the vitest or jest config (`verid cook` says so when it sees both).
- Rust and CMake have no report flag: set `test_cmd`. With no runner, `verid taste` refuses (`VERID_BURNT_RUN_NO_RUNNER`), and also once a runner it ran is gone (`VERID_BURNT_RUN_RUNNER_GONE`), until `verid cook` runs again.

## Limitations

A hook is not an OS sandbox: verid closes the usual shortcuts, not every path a determined agent could take.

**Codex**

- Codex fails open when a hook crashes, times out or emits malformed output; verid's internal fail-closed handling cannot prevent those host decisions.
- Codex skips untrusted hooks; project trust and each hook's trust must be reviewed, and doctor cannot force enforcement.
- Codex skill activation has no universal hook event; `allowed_skills` is advisory there, including skills that fork.
- Codex spawn messages are opaque in captured hooks, so verid cannot verify that a reviewer received only the ACs, design path and diff.
- The reviewer's independent model/effort settings remain unproven on the host until the controller's live check confirms them.
- Resolving `verid_reviewer` from user-layer config remains unproven on the host until the controller's live check confirms it.
- Interactive shell continuation input can be unhooked; a permitted process may receive later input that verid never judges.
- PowerShell write targets are parsed heuristically; scripts, computed paths and runtime writes can evade target detection.
- Codex never sends a Bash call's `workdir` to hooks, so relative Bash and PowerShell targets are judged against the session folder; a call run in another `workdir`, or one that changes folder first (`cd`, `Set-Location`), can write a path other than the one verid judged.
- The shell patch check matches the patch program's plain name; an escaped or computed name (``apply`_patch``, `& $program`) can still run the Codex patch shim.
- SubagentStop uses the Stop hold JSON shape, but the host's response to a SubagentStop hold remains untested.
- A Codex child call without identity is treated as the main agent; it can write tests and code under the TDD gate.
- Codex has no authenticated attended-input exception transport here; `/verid tip` and `/verid confirm` cannot create overrides.
- With a relocated `CODEX_HOME`, reads of its `sessions/`, `history.jsonl` and `sqlite/` are blocked, but not of other state databases at its root.
- With no overrides on Codex, a Bash rule's false positive stays denied (such as `grep codex` matching the nested-Codex rule, or `grep apply_patch` the shell patch rule); run that command in your own terminal.
- Codex has no direct Write/Edit tool and verid does not simulate patches, so while a verid block exists the agent cannot change `AGENTS.md` or `CLAUDE.md`; edit them yourself.
- The best-effort Codex developer CLI guard uses internal environment markers whose coverage across installed hosts is unproven; without a recognized marker, recognizable developer calls rely on the hook rule.

**Workflow plugins**

- Plugin code has your full rights: it can change files, state or hooks directly, and can load project code or tools outside its protected folder. Review sources and dependencies; verid does not sandbox them.
- Bash can still change plugin files on disk through the gaps below; verid refuses to run changed plugin code or registrations until the developer re-approves with `verid plugin add` or a confirmed cook/upgrade restore. Scripts, computed paths, unknown writers and external processes can still reach plugin files and data. Bash mentioning `.verid/plugins`, `plugins.json` or `plugin-data` is conservatively refused, including reads and unrelated names containing those substrings; use Read or Glob. These denials cannot be overridden. Workspace commands such as `git -C .verid commit` and ordinary application `plugins/` paths are allowed.
- Existing hard links can expose a protected file through another name; another process can also replace a checked path before copying or execution. The hook does not prevent filesystem races.
- A restore checks a local source's declared version, then records a new content approval; that source can change between installs. A git commit or npm version does not prove a source is trustworthy, and npm dependencies are not locked across reinstalls. Fetching uses `npm install --ignore-scripts --no-bin-links`; npm also suppresses `prepare` for git dependencies, so packages that need generated files may not work.
- Events are observations, not a queue: a crash between saving a decision and delivery can lose an event, and failed or timed-out events are not retried. Auto transitions are noticed on Stop/SubagentStop; historical served modules may be reported on the first observation. Later plugins may be skipped when the shared budget is exhausted. Timeout terminates the process tree; children that escape it or cannot be killed due to OS permissions can survive.
- Plugin-data may contain information the agent can read unless the existing secret-file rules match it. Plugins should keep credentials outside committed data. The audit cannot record a failure while its own storage is unavailable; the warning reports that too.

**Bash and other tools**

- Bash is matched as text: variables, `$(...)`, `$'...'`, globs, scripts, `cd` then a relative write path, `git checkout`/`restore`/`apply`, `prettier --write` and run-time paths get through. There is no Bash allowlist, on purpose.
- Bash separator normalization can miss doubled separators or `/./` after shell punctuation inside a quoted path component, such as `cc(parent)//projects` under a relocated config directory.
- The same matching blocks some harmless commands (`jq '.key'`, a commit message containing `secret`, `other-verid upgrade`, `npx @vue/cli upgrade`, `npx expo-cli upgrade`); `/verid tip` passes overridable rules. Recognisable developer commands match at word boundaries, including `verid@<version>`, scoped npm names, Windows prefixes `@`, `,` and `=`, and bare `cli` / `cli.js` entry points after `cd` or clearing the environment. An optional `--` before the subcommand is matched too, including `npm exec verid -- plugin`, `npm x -y verid -- cook`, `npx verid -- plugin` and `pnpm exec verid -- plugin`. Computed command names and wrapper scripts still have the gap described below; plugin commands cannot be overridden.
- On Claude Code, other shells are known only by the name `PowerShell` or a top-level `command` key: a command in an array, nested, or under `cmd`/`script` gets through; an unrelated `command` is blocked by mistake. Codex denies unknown tools and unsupported dynamic shell forms.
- MCP tools are judged by path-like keys and a name that says they write: other keys and silent writers get through; a remote path may be blocked by mistake.
- Grep and Glob over a folder can read the secrets in it; only the secret file itself is blocked.
- Windows NTFS stream suffixes are stripped from every path component before policy checks, including new targets. Symlinks and junctions resolve only for the parts of a path that exist, so a Windows 8.3 short name of a new file can still slip past.
- Windows UNC administrative drive shares on any host are judged as the local drive, including mapped-drive paths whose realpath returns such a share. Other shares, mapped network drives to other shares and `subst` aliases are not mapped; equivalent paths can bypass protections that compare local path prefixes. Bash mentions do not resolve mapped drive letters.

**Evidence and the cycle**

- Workspaces share one cycle: a failing test in one repo can open production code in another. verid does not verify cross-repo dependencies, API compatibility or which repo a module should change.
- Paths outside every listed repo keep the existing rule: policy and writer restrictions apply, while TDD globs do not. Workspace root files and unlisted repos are outside the auto git checks; `.verid` is included.
- Test code runs with full rights in `verid taste` and could overwrite its report; the audit's sha256 shows it only afterwards, and the hash chain detects log edits without preventing them.
- Tests are frozen only in COOKING: in RAW and PLATED, weakening one test while adding a failing one gets through.
- verid cannot tell whether code goes beyond the tests; PLATED allows new behaviour within a conversation.
- Runner config outside `test_globs`, or a build file, can leave a failing test out of a run.
- The Stop check sees only writes the hook judged, and a write counts before the permission prompt, even if the developer declines it.
- Only a failure whose type names an error (`…Error`, `…Exception`) is a crash; anything else, such as a Go panic or a `calc.NotReady` exception, is an assertion, so RED.
- The stub step cannot tell a stub from a full implementation; a test that crashes on purpose opens it too, and code that makes the test pass stays.
- One behaviour at a time is only a warning.

**Remix baseline**

- The baseline goes by test name: a renamed test is a new failure, and a new test named like a baseline test is hidden while it fails.
- A test file that fails to load is one test named after the file; with jest-junit or pytest classes it can stay in the baseline and hide a later load error.
- `verid stock` records whatever fails when it runs: run it before the agent starts.
- The baseline, approved modules and reviews live in `.verid/.state/` on one machine: a teammate runs `verid stock` or `verid order` after cloning.

**Plan and modules**

- Iteration dates and assignments do not change module order. With iterations on, invalid metadata on the first nonempty line under a module heading makes its module unorderable and holds the whole auto drive like any plan problem; editing the line invalidates approval like any other edit. The hook does not enforce scheduling, iteration assignments or whether the work fits the duration.
- An AC is covered when its code is in a passing test's id, file path included: an `AC-1` test that asserts nothing counts, as does every test in `AC-1-login.test.ts`.
- AC codes match exactly: `AC-01` is not `AC-1`.
- An approval covers bytes, not meaning: any edit to the module's section or `.verid/design.md` (a space, a BOM, CRLF line endings), or a plan that stops parsing, locks production code until `verid order` again.
- In the human drive, a module's Stop holds (uncovered ACs, then evaluate) are one per conversation together, and verid remembers only the last conversation.
- The plan gate, like the RAW lock, looks at `source_globs` only.
- Locks go by path, not content: logic in an ignored file (`setup.py`, `build.gradle`, JSON, HTML) is free, `FooTest.java` outside `src/test/` is code, and a test in its code's file (Rust) cannot be told apart.
- `verid serve` needs a review recorded after the last change but does not judge it: the developer reads it. The main conversation writes the reviewer's prompt, so verid knows a reviewer ran, not what it checked or how closely.
- One module and one TDD cycle are open at a time, and module boundaries are not checked against the code: another module's behaviour gets through.
- verid cannot tell who answered a question: `verid order` is the sign-off; answers in the plan's intro or `.verid/research.md` need none.
- `.verid/research.md` is checked for existence, not authorship; splitting into modules is only a reminder.
- With every module served, production code stays locked until a new module is approved; `verid garnish` does not lift it.

**Roles and agents**

- The hook cannot verify that drafting agents presented a proposal, relayed questions with options, got the developer's answers, or agreed scope, boundaries and a dependency DAG before writing.
- The main conversation and other agents can still write research, design and plan documents: dispatching the mapped drafting role is a skill instruction.
- A path in `e2e_globs` cannot prove a test drives the product end to end or that qa took its selectors from real UI source.
- Roles go by the payload's `agent_type`: if Claude Code renames or drops it, subagents look like the main conversation, so split code and test writes are blocked, `verid serve` refuses without a reviewer, and auto fails closed.
- On Claude Code, the skill allowlist closes the `context: fork` route for skills outside the list. An allowed skill can still fork into another agent type, judged as `other`: in split mode it cannot write code or tests, but it can write free files and run Bash.
- Names in `roles` match exactly: an agent its plugin renames loses its role, failing closed (writes blocked, `verid serve` refuses).
- The Claude Code verid plugin installs apart from the npm package: until it is installed, `roles` names missing agents (writes blocked, `verid serve` refuses), and updating only one lets them drift apart.
- Split, the tester can still weaken a test in RAW or PLATED: the split only stops the coder.
- On Claude Code, the tester and coder have Bash, and only the hook keeps each to its part. The split is on by default, so the main conversation no longer writes code or tests.
- Agents from other plugins, or ClaudeKit's, mapped in `roles` do not know verid: only the hook's refusals guide them. verid's own agents do know it.
- An agent name with no namespace (`general-purpose`, or one in `~/.claude/agents/` such as ClaudeKit's) is replaced by a `.claude/agents/<name>.md` in a freshly cloned repo; `verid:*` names are not. The hook stops the agent creating that file, not one already there. A `.claude/skills/` skill already on disk (from a cloned repo or another kit) whose `name` uses an allowed namespace also passes the allowlist, including nested folders.
- Skills from verid, superpowers and andrej-karpathy-skills are prompts: the hook cannot tell whether the agent uses or follows them.

**Auto drive**

- The hook does not enforce `feat/<module>`, one branch per module or which branch holds a commit; it still checks only that the project's tree is clean.
- The reviewer writes its own verdict: verid reads only the `Verdict:` line, not how closely it read, and no person reads a review before a module closes.
- The security reviewer is a model reading the diff, not a scanner: it runs no tool and sees only what it is given, so its pass is no proof that the module is safe.
- In a project with both providers `roles.security` is mapped, so a module closed from a Codex session also needs a security verdict: review it in Claude Code, or map a Codex security agent.
- The agent writes the plan and the reviewer reviews it; no person signs it.
- A report is filed as a plan or module review by where the drive stands, not by what the reviewer was asked to review.
- The dispatching agent writes the reviewer's and the security reviewer's prompts, so verid does not know what they were shown; a background reviewer or security reviewer still running while code changes records its report as after the last change.
- A coder round counts by the AC named in the red test when the coder stops; a red test naming no AC is not counted.
- Git checks tree cleanliness in the layout's checked folders, not commit contents, module ownership or coordinated commits across repos.
- A git error in a repo (dubious ownership, a corrupt index or config), or a repo losing git after it was signed with git present, counts as uncommitted. Option C applies per repo: a folder signed without git skips that check until git appears; dropping git takes a new `verid order`.
- Files git itself hides are not uncommitted: `.gitignore`, `.git/info/exclude` and global ignore (`core.excludesFile`) entries, `assume-unchanged` or `skip-worktree` files, submodules with `ignore` set.
- The agent cannot name `.claude/settings.local.json` or `.codex/hooks.json` in Bash, so it usually commits with `git add -A`; the git checks ignore both, Claude Code usually lists the first in the global gitignore, and without a gitignore line either can be committed.
- Claude Code does not run Stop on Esc: an interrupt is not counted as no progress, but the agent is not held either.
- `.verid/blocked.md` is the agent's own word: it can report a block that is not there (but then stops for good).
- A block latches only when a hook sees `.verid/blocked.md` (a Stop, or a tool call that writes): a script that deletes it first and does not look like a write, such as `node cleanup.js`, leaves no block.
- "No progress" goes by what the hook sees: a Bash write it does not recognise is not progress.
- The no-progress count compares each Stop with the one before only: churn without real progress (a flaky test, a byte of `.verid/plan.md` toggled, empty commits) resets it, so that loop is not capped.
- While stuck, a code write needs two `/verid tip`s (the stuck lock, then no open module), like any call two rules block.
- Auto holds every Stop whatever `stop_hook_active` says: if Claude Code changes what that flag means, the agent may stop mid-drive.

**Architecture**

- The design table, SOLID/DDD semantics and review thoroughness are judgments; signing approves bytes.
- Remix design agreement has no signature gate.
- Architecture tools are opt-in per repo; without one, dependency direction is checked by review.
- A configured architecture gate blocks module close, not the violating edit.
- Static checks cover configured rules and resolution, not Spring runtime wiring, reflection or computed dynamic loading.
- Project checker code and dependencies run with your rights and can weaken results; verid does not sandbox them. The agent can edit the checker's rules and configuration like any file the manifest leaves free; the next pass then reflects the edited rules.
- Undeclared checker inputs, external tools and environment changes are outside the freshness snapshot, and so are files in folders the manifest leaves free (such as `node_modules` or `dist`) and in hidden folders (such as `.gradle` or `.import_linter_cache`, which checkers rewrite as they run) unless an input names them. A checker that rewrites its own inputs stays stale.
- A declared input changed and restored while a check runs is not caught: free files do not move the TDD revision, and the snapshots before and after the run match, so a check that read weakened rules can record a pass the final diff does not show.
- In the auto drive an architecture result is not progress: a fix that turns a failed check into a pass counts only once it leads to a commit, a review or a test change, so three holds in a row on failing or uncommitted fixes leave the drive stuck, as for any loop.
- Every close path, the session-start menu, `/verid:menu` and `/verid:peek` read the checked repos' files again, outside the state lock but within the hook's timeout. In a very large repo that read can push a hook past it: Claude Code and Codex then let that Stop through (the auto drive loses that hold), a reviewer stop that times out records no review, and the session-start menu is lost. The module still closes only on a fresh pass.
- On Linux and macOS, a link in a checked repo to a FIFO or another special file blocks the snapshot's read; a hook doing that read then times out and fails open as above.
- A missing program is found before the run only for a plain command name or path; behind a shell built-in or form verid does not read, cmd.exe answers it with exit 1, which reads as a failed check.

**Runners**

- Doctor recognizes runners from build files or a custom `test_cmd`; it does not run tests or verify that the runner's executable is installed.
- Build files are not locked: the agent can add a runner, or make one skip tests.
- A build file more than one folder down (`packages/a/b/pom.xml`) is not found; set `test_cmd`.
- Deleting a build file is caught by the remembered runner, but `verid cook` drops that runner without asking.
- Maven and Gradle reports are read from unprotected project folders: test code, a plugin or a leftover process could write one.
- Only vitest and Maven were run for real, and Playwright's JUnit report checked by hand; the other runners follow their documentation.
- Every test Playwright reports is end-to-end; other runners go by path, so a unit test in `e2e/` counts and an end-to-end test outside `e2e_globs` does not.
- With `test_cmd`, verid does not know the runner: a Playwright test counts only if its file matches `e2e_globs`, and Playwright names files from its `testDir`.
- pytest, Java, .NET and Go report a class, not a file: put their end-to-end tests in a folder or package named `e2e`.
- jest reports the describe block unless `JEST_JUNIT_CLASSNAME={filepath}` is set, and Maven's failsafe integration tests are not in `mvn test`: set `test_cmd`.
- `verid taste` runs the end-to-end tests every time, so the cycle is as slow as they are.
- jest-junit needs `JEST_JUNIT_REPORT_TEST_SUITE_ERRORS=true`, or a test file that fails to load is missing from the report.
- In compiled languages a test calling a missing class leaves no report, so the first stub needs an override; verid says so for Maven and Gradle, and never reads the build log.
- A `timeout_sec` over the Bash tool's 2 minutes lets Claude Code kill `verid taste` first, and the tests may keep running.
- Repo timeouts run sequentially, and architecture checks run after the suite, so their sum can exceed the Bash tool's timeout even when each stays under its own.
- Globs ignore case on every platform.

**Self-protection and overrides**

- Direct Write/Edit/MultiEdit calls may edit user content around an unchanged verid block. Recognized Bash, MCP and Codex `apply_patch` writes to instruction files are denied because their resulting content cannot be verified; read them with Read. Scripts, computed paths, unrecognized writers and filesystem races retain the gaps described here. `verid upgrade` restores a missing or edited block while keeping user content.

- The agent can still add instructions outside the block or in `CLAUDE.local.md`, `.claude/CLAUDE.md` or `.claude/rules/`; the block is guidance, and only the hooks enforce the rules.
- Doctor checks version-2 plugin install records and directories under `CLAUDE_CONFIG_DIR` (default `~/.claude`); it cannot prove the plugins are enabled or their skills load.
- verid's `dist/` and `plugin/` folder (skills and the Codex reviewer template) are protected; editing `i18n/*.json` changes messages, not decisions.
- Recognized writes to agent, plugin, skill and command definitions in project or home `.claude/` directories and `CLAUDE_CONFIG_DIR` are blocked; deleting a parent folder without naming those children, scripts, computed paths, unrecognized writers, existing hard links and filesystem races retain gaps. Hooks in already installed skill, command or subagent frontmatter and plugins run unchecked and can rewrite tool input after verid judged it.
- Bash checks `.claude/skills/` and `.claude/commands/` only as parsed write targets, so it can read or run skill scripts; unparsed writes such as `cd <skill-or-command-dir>; printf x > file`, scripts and computed paths remain open. The existing `.claude/commands/verid/` mention rule still applies.
- Bash mentioning `.claude/agents`, `.claude/plugins` or `.claude/commands/verid` is blocked even to read (use Read or Glob); the developer edits those definitions.
- Bash mentioning any file named `manifest.yaml` is blocked even to read, such as `cat .verid/manifest.yaml`: use Read, or `/verid tip`.
- Deleting `.verid` blocks every tool call.
- Developer commands and `CLAUDECODE` are kept out of the agent's Bash by name only: through a script, a variable or a run-time string the agent could refresh setup with upgrade, record its own baseline, approve or close its own module, or in auto sign the design or resume a stuck drive.
- The agent's Bash inherits `CLAUDE_CODE_SESSION_ATTENDED`: commands naming verid's hook are blocked, but through a copy of the hook, a script or a built path the agent could grant itself an override.
- A pseudo-terminal tool such as `node-pty` could start a nested session that Claude Code treats as attended.
- The confirmation code stays in the transcript on disk, which the agent is blocked from reading.
- Overrides rely on Claude Code's internal `CLAUDE_CODE_SESSION_ATTENDED`: if it is renamed, overrides stop and everything stays blocked.
- An override lifts only the rule it names; the other rules, the role rules and the TDD gate still judge the call, and each that denies needs its own `/verid tip`.
- On Claude Code, an overridden unsupported PowerShell call has no target analysis; an MCP tool with a `command` is judged only on the paths its input names. Codex adds heuristic PowerShell target parsing, with the gaps above.
- The interactive setup needs a real terminal and is tested with a simulated one.
- Status lines, file paths and parser details stay in English; a hook payload that is not JSON gets both languages.
- Under heavy load a blocked call may get `VERID_BURNT_LOCK_TIMEOUT`: still blocked, but not counted.

## Development

```bash
npm test             # build, then unit and end-to-end tests
npm run test:full    # the same plus the installer tests
npm run typecheck
npm run format
```

There is no CI: `test/e2e/hook.e2e.test.ts` replays payloads recorded on Windows, so run `npm test` on Windows before each commit, and `npm run test:full` when `install.ps1`, `install.sh` or their tests change.

## Credits

verid stands on two projects:

- **[superpowers](https://github.com/obra/superpowers)** by Jesse Vincent: verid's cycle is the RED-GREEN-REFACTOR loop of its `test-driven-development` skill, and "evidence before claims" comes from `verification-before-completion`. verid adds the hook that enforces them.
- **[andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills)** by forrestchang: think before coding, simplicity first, surgical changes, goal-driven execution.

verid is an independent project, not affiliated with either.

## License

MIT, see [LICENSE](./LICENSE).
