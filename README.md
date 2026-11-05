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

## Workflow

```mermaid
flowchart LR
  R[Research] --> S[Spec] --> D[Design] --> P[Plan] --> O[Order] --> B[Build and taste] --> V[Review] --> C[Serve] --> H[Commit, push, PR]
  C -->|next module| O
```

| Step              | Owner                                         | Result                                                                                                                          |
| :---------------- | :-------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| Research and spec | main, `verid:ba`                              | Read `.verid/docs/`; write sourced requirements in `.verid/research.md` and `.verid/spec.md`.                                   |
| Design and plan   | architect, planner                            | Agree interfaces and dependencies; write `.verid/design.md` and testable ACs in `.verid/plan.md`.                               |
| Order             | developer in human drive                      | `verid order <module>` approves the module. Auto opens modules in file order after plan review; `Depends:` names prerequisites. |
| Build             | tester or QA, then coder                      | One AC at a time: fail an assertion, implement, pass `verid taste`, refactor. Main appends `.verid/log/<module>.md`.            |
| Review            | reviewer, then security when mapped           | Read `verid menu --commits --file` and end each report with `Verdict: pass` or `Verdict: fail`.                                 |
| Serve and handoff | developer in human drive; auto closes modules | `verid serve <module>` requires covered ACs, current passing evidence and reviews. After `product`, commit, push and open a PR. |

## TDD cycle

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

## Limitations

A hook is not an OS sandbox: verid closes the usual shortcuts, not every path a determined agent could take.

<details>
<summary>Codex (17)</summary>

- Codex fails open when a hook crashes, times out or emits malformed output; verid's internal fail-closed handling cannot prevent those host decisions.
- Codex skips untrusted hooks; project trust and each hook's trust must be reviewed, and doctor cannot force enforcement.
- Codex skill activation has no universal hook event; `allowed_skills` is advisory there, including skills that fork.
- Codex spawn messages are opaque in captured hooks, so verid cannot verify that a reviewer received only module/AC identifiers and plan, design and review-packet paths.
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

</details>

<details>
<summary>Bash and other tools (9)</summary>

- Bash is matched as text: variables, `$(...)`, `$'...'`, globs, scripts, `cd` then a relative write path, `git checkout`/`restore`/`apply`, `prettier --write` and run-time paths get through. There is no Bash allowlist, on purpose.
- Bash separator normalization can miss doubled separators or `/./` after shell punctuation inside a quoted path component, such as `cc(parent)//projects` under a relocated config directory.
- The same matching blocks some harmless commands (`jq '.key'`, a commit message containing `secret`, `other-verid upgrade`, `npx @vue/cli upgrade`, `npx expo-cli upgrade`); `/verid tip` passes overridable rules. Recognisable developer commands match at word boundaries, including `verid@<version>`, scoped npm names, Windows prefixes `@`, `,` and `=`, and bare `cli` / `cli.js` entry points after `cd` or clearing the environment. An optional `--` before the subcommand is matched too, including `npm exec verid -- plugin`, `npm x -y verid -- cook`, `npx verid -- plugin` and `pnpm exec verid -- plugin`. Computed command names and wrapper scripts still have the gap described below; plugin commands cannot be overridden.
- On Claude Code, other shells are known only by the name `PowerShell` or a top-level `command` key: a command in an array, nested, or under `cmd`/`script` gets through; an unrelated `command` is blocked by mistake. Codex denies unknown tools and unsupported dynamic shell forms.
- MCP tools are judged by path-like keys and a name that says they write: other keys and silent writers get through; a remote path may be blocked by mistake.
- Grep and Glob over a folder can read the secrets in it; only the secret file itself is blocked.
- Windows NTFS stream suffixes are stripped from every path component before policy checks, including new targets. Symlinks and junctions resolve only for the parts of a path that exist, so a Windows 8.3 short name of a new file can still slip past.
- Windows UNC administrative drive shares on any host are judged as the local drive, including mapped-drive paths whose realpath returns such a share. Other shares, mapped network drives to other shares and `subst` aliases are not mapped; equivalent paths can bypass protections that compare local path prefixes. Bash mentions do not resolve mapped drive letters.
- `VERID_BURNT_BASH_DANGEROUS` reads the command text: a script that does the same, a variable or alias, or a download saved to a file and run in a later command gets through. A quoted argument with a blank is not read for the flag rules, so `-m "…--no-verify…"` passes.

</details>

<details>
<summary>Evidence and the cycle (10)</summary>

- Workspaces share one cycle: a failing test in one repo can open production code in another. verid does not verify cross-repo dependencies, API compatibility or which repo a module should change.
- Paths outside every listed repo keep the existing rule: policy and writer restrictions apply, while TDD globs do not. Workspace root files and unlisted repos are outside the auto git checks; `.verid` is included.
- Test code runs with full rights in `verid taste` and could overwrite its report; the audit's sha256 shows it only afterwards, and the hash chain, which `verid doctor` checks, detects log edits without preventing them.
- Tests are frozen only in COOKING: in RAW and PLATED, weakening one test while adding a failing one gets through.
- verid cannot tell whether code goes beyond the tests; PLATED allows new behaviour within a conversation.
- Runner config outside `test_globs`, or a build file, can leave a failing test out of a run.
- The Stop check sees only writes the hook judged, and a write counts before the permission prompt, even if the developer declines it.
- Only a failure whose type names an error (`…Error`, `…Exception`) is a crash; anything else, such as a Go panic or a `calc.NotReady` exception, is an assertion, so RED.
- The stub step cannot tell a stub from a full implementation; a test that crashes on purpose opens it too, and code that makes the test pass stays.
- One behaviour at a time is only a warning.

</details>

<details>
<summary>Remix baseline (4)</summary>

- The baseline goes by test name: a renamed test is a new failure, and a new test named like a baseline test is hidden while it fails.
- A test file that fails to load is one test named after the file; with jest-junit or pytest classes it can stay in the baseline and hide a later load error.
- `verid stock` records whatever fails when it runs: run it before the agent starts.
- The baseline, approved modules and reviews live in `.verid/.state/` on one machine: a teammate runs `verid stock` or `verid order` after cloning.

</details>

<details>
<summary>Plan and modules (15)</summary>

- Iteration dates and assignments do not change module order. With iterations on, invalid metadata on the first nonempty line under a module heading makes its module unorderable and holds the whole auto drive like any plan problem; editing the line invalidates approval like any other edit. The hook does not enforce scheduling, iteration assignments or whether the work fits the duration.
- An AC is covered when its code is in a passing test's id, file path included: an `AC-1` test that asserts nothing counts, as does every test in `AC-1-login.test.ts`.
- AC codes match exactly: `AC-01` is not `AC-1`.
- An approval covers bytes, not meaning: any edit to the module's section (a space, a BOM, CRLF line endings), or a plan that stops parsing, locks production code until `verid order` again.
- In the human drive, a module's Stop holds (uncovered ACs, then evaluate) are one per conversation together, and verid remembers only the last conversation.
- The plan gate, like the RAW lock, looks at `source_globs` only.
- Locks go by path, not content: logic in an ignored file (`setup.py`, `build.gradle`, JSON, HTML) is free, `FooTest.java` outside `src/test/` is code, and a test in its code's file (Rust) cannot be told apart.
- `verid serve` needs a review recorded after the last change but does not judge it: the developer reads it. The main conversation writes the reviewer's prompt, so verid knows a reviewer ran, not what it checked or how closely.
- verid reads only a security report's final `Verdict` line; its review status, coverage and masking follow the skill's contract but no code checks them. Ignoring instructions planted in reviewed code, docs or audit output is a prompt rule, not yet measured by an evaluation.
- The security reviewer masks secrets in its report, but values its Read or Grep already returned stay in the session transcript.
- One module and one TDD cycle are open at a time, and module boundaries are not checked against the code: another module's behaviour gets through.
- verid cannot tell who answered a question: `verid order` is the sign-off; answers in the plan's intro or `.verid/research.md` need none.
- `.verid/research.md` is checked for existence, not authorship; splitting into modules is only a reminder.
- `.verid/feedback.md` is a convention: the hook does not check that only the main thread writes it, that entries are only appended, or that it holds no code or secrets; reviewers and the security reviewer cannot write it.
- With every module served, production code stays locked until a new module is approved; `verid garnish` does not lift it.

</details>

<details>
<summary>Roles and agents (12)</summary>

- The hook cannot verify that drafting agents presented a proposal, relayed questions with options, got the developer's answers, or agreed scope, boundaries and a dependency DAG before writing.
- The main conversation and other agents can still write research, design and plan documents: dispatching the mapped drafting role is a skill instruction.
- A path in `e2e_globs` cannot prove a test drives the product end to end or that qa took its selectors from real UI source.
- Roles go by the payload's `agent_type`: if Claude Code renames or drops it, subagents look like the main conversation, so split code and test writes are blocked, `verid serve` refuses without a reviewer, and auto fails closed.
- Known skills are advisory; the old allowlist no longer closes the `context: fork` route for skills outside the list. An allowed skill can still fork into another agent type, judged as `other`: in split mode it cannot write code or tests, but it can write free files and run Bash.
- Names in `roles` match exactly: an agent its plugin renames loses its role, failing closed (writes blocked, `verid serve` refuses).
- The Claude Code verid plugin installs apart from the npm package: until it is installed, `roles` names missing agents (writes blocked, `verid serve` refuses), and updating only one lets them drift apart.
- Split, the tester can still weaken a test in RAW or PLATED: the split only stops the coder.
- On Claude Code, the tester and coder have Bash, and only the hook keeps each to its part. The split is on by default, so the main conversation no longer writes code or tests.
- Agents from other plugins, or ClaudeKit's, mapped in `roles` do not know verid: only the hook's refusals guide them. verid's own agents do know it.
- An agent name with no namespace (`general-purpose`, or one in `~/.claude/agents/` such as ClaudeKit's) is replaced by a `.claude/agents/<name>.md` in a freshly cloned repo; `verid:*` names are not. The hook stops the agent creating that file, not one already there. A `.claude/skills/` skill already on disk (from a cloned repo or another kit) whose `name` uses an allowed namespace also passes the allowlist, including nested folders.
- Bundled verid skills and any additional skills are prompts: the hook cannot tell whether the agent uses or follows them.

</details>

<details>
<summary>Git (4)</summary>

- Git conventions are advisory; audit cannot prove remote protection, PR workflow, commit atomicity or that main is current.
- History is limited to recorded local bases; absent or unreadable Git produces warnings and does not block a module.
- The `.git` rule recognizes written paths and literal shell words; scripts, computed paths and unseen links can still alter Git internals. Git's global configuration is recognized by filename.
- Git diagnostics can run repository clean/process filters; filesystem monitoring is disabled, but this is not an OS sandbox.

</details>

<details>
<summary>Auto drive (3)</summary>

- Auto keeps developer signing, reviewed plans, TDD, module/security reviews, blocked-file latching and three-attempt limits. It does not enforce branches, commits or integration.
- A design or research change is advisory; a changed served module still stops the drive. Git activity alone does not count as TDD progress.
- Reviews and test freshness see hook-observed writes. Changes made outside hooked tools may evade invalidation; inspect the final diff before accepting a module.

</details>

<details>
<summary>Architecture (3)</summary>

- Architecture rules and checker results are advisory. The reviewer checks the selected architecture; convention departures alone do not fail the verdict.
- Checkers and their dependencies execute with your rights. Static tools cover only their own rules; verid does not sandbox them or hash their inputs for freshness.
- The latest checker result is an observation, not proof that files, external tools or the environment stayed unchanged.

</details>

<details>
<summary>Runners (16)</summary>

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

</details>

<details>
<summary>Self-protection and overrides (25)</summary>

- Review packets are snapshots, separate from signed review reports. Recognized agent writes to `.verid/review/` are blocked, but scripts, computed paths, unrecognized writers, existing hard links and filesystem races retain the same gaps as other protected paths.

- Direct Write/Edit/MultiEdit calls may edit user content around an unchanged verid block. Recognized Bash, MCP and Codex `apply_patch` writes to instruction files are denied because their resulting content cannot be verified; read them with Read. Scripts, computed paths, unrecognized writers and filesystem races retain the gaps described here. `verid upgrade` restores a missing or edited block while keeping user content.

- The agent can still add instructions outside the block or in `CLAUDE.local.md`, `.claude/CLAUDE.md` or `.claude/rules/`; the block is guidance, and only the hooks enforce the rules.
- Doctor checks version-2 plugin install records and directories under `CLAUDE_CONFIG_DIR` (default `~/.claude`); it cannot prove the plugins are enabled or their skills load.
- verid's `dist/` and `plugin/` folder (skills and the Codex reviewer template) are protected; editing `i18n/*.json` changes messages, not decisions.
- Recognized writes to agent, plugin, skill and command definitions in project or home `.claude/` directories and `CLAUDE_CONFIG_DIR` are blocked; deleting a parent folder without naming those children, scripts, computed paths, unrecognized writers, existing hard links and filesystem races retain gaps. Hooks in already installed skill, command or subagent frontmatter and plugins run unchecked and can rewrite tool input after verid judged it.
- Bash checks `.claude/skills/` and `.claude/commands/` only as parsed write targets, so it can read or run skill scripts; unparsed writes such as `cd <skill-or-command-dir>; printf x > file`, scripts and computed paths remain open. The existing `.claude/commands/verid/` mention rule still applies.
- Writes to MCP server lists, meaning any file named `.claude.json` or `.mcp.json` (so `~/.claude.json` and `<CLAUDE_CONFIG_DIR>/.claude.json` too), are blocked for file tools, MCP writers, parsed Bash write targets and Codex `apply_patch` and PowerShell targets; reads stay open. As with the other protected targets, scripts, computed paths, unrecognized writers and existing hard links can still reach them. `claude mcp add` stays blocked as a nested Claude Code session.
- Bash mentioning `.claude/agents`, `.claude/plugins` or `.claude/commands/verid` is blocked even to read (use Read or Glob); the developer edits those definitions.
- Bash mentioning any file named `manifest.yaml` is blocked even to read, such as `cat .verid/manifest.yaml`: use Read, or `/verid tip`.
- `.verid/docs/` is protected only from the writes the hook recognizes: Write/Edit, patches, MCP writers and parsed Bash or PowerShell targets. A script, a computed path or a program that writes without a recognized target can still change it.
- Deleting `.verid` blocks every tool call.
- Developer commands and `CLAUDECODE` are kept out of the agent's Bash by name only: through a script, a variable or a run-time string the agent could refresh setup with upgrade, record its own baseline, approve or close its own module, or in auto sign the design or resume a stuck drive.
- The agent's Bash inherits `CLAUDE_CODE_SESSION_ATTENDED`: commands naming verid's hook are blocked, but through a copy of the hook, a script or a built path the agent could grant itself an override.
- A pseudo-terminal tool such as `node-pty` could start a nested session that Claude Code treats as attended.
- The confirmation code stays in the transcript on disk, which the agent is blocked from reading.
- Overrides rely on Claude Code's internal `CLAUDE_CODE_SESSION_ATTENDED`: if it is renamed, overrides stop and everything stays blocked.
- An override lifts only the rule it names; the other rules, the role rules and the TDD gate still judge the call, and each that denies needs its own `/verid tip`.
- On Claude Code, an overridden unsupported PowerShell call has no target analysis; an MCP tool with a `command` is judged only on the paths its input names. Codex adds heuristic PowerShell target parsing, with the gaps above.
- The interactive setup needs a real terminal and is tested with a simulated one.
- Messages come in the language chosen at `verid cook` (`--lang vi|en`, or the interactive choice); without one, cook keeps the system's language (LC_ALL, LC_MESSAGES or LANG first, else the OS setting), Vietnamese or else English, so a machine's messages come in one language.
- Status lines, file paths and parser details stay in English; a hook payload that is not JSON gets both languages.
- Under heavy load a blocked call may get `VERID_BURNT_LOCK_TIMEOUT`: still blocked, but not counted.
- Off Windows the hook compares paths by letter case and relies on `realpath` to return the stored spelling. On a case-insensitive macOS volume, whether another spelling such as `.VERID/.State/state.json` is still protected has not been verified: its test runs on case-insensitive file systems, which CI covers on Windows only.
- `verid halt` stops only the tool calls a hook sees: a process the agent started earlier (a dev server, a running script) keeps running, and on Codex a hook that crashes, times out or is not trusted fails open. Stop those processes yourself, and close a Codex session you halted.

</details>

## Development

`npm run typecheck`, `npx prettier --check .`, `npm test`; Windows CI also runs `npm run test:full` in [ci.yml](.github/workflows/ci.yml).

## Credits

verid draws on [superpowers](https://github.com/obra/superpowers) and [andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills). See the bundled skill licenses for attribution.

## License

MIT. See [LICENSE](LICENSE).
