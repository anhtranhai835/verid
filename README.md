```
 ██╗   ██╗ ███████╗ ██████╗  ██╗ ██████╗
 ██║   ██║ ██╔════╝ ██╔══██╗ ██║ ██╔══██╗
 ██║   ██║ █████╗   ██████╔╝ ██║ ██║  ██║
 ╚██╗ ██╔╝ ██╔══╝   ██╔══██╗ ██║ ██║  ██║
  ╚████╔╝  ███████╗ ██║  ██║ ██║ ██████╔╝
   ╚═══╝   ╚══════╝ ╚═╝  ╚═╝ ╚═╝ ╚═════╝
     hook-enforced TDD for Claude Code · RAW → COOKING → PLATED
```

# verid

**English** · [Tiếng Việt](README.vi.md)

> The agent does the work. verid verifies it. The developer approves.

## Why

Coding agents in a hurry skip the test: they write the code first, or weaken a test until it goes green. A prompt can ask for TDD; a hook can refuse the write. verid puts a fail-closed hook in front of every Claude Code tool call and holds the agent to the RED → GREEN → REFACTOR cycle of the [superpowers](https://github.com/obra/superpowers) `test-driven-development` skill, named RAW → COOKING → PLATED. Only the developer can open an exception, and a hash-chained audit log records it. In your project verid adds only `.verid/`, `.claude/commands/verid/` and the per-machine `.claude/settings.local.json`.

## Requirements

- Node.js 22 or later, and [Claude Code](https://claude.com/claude-code).
- The superpowers plugin, whose skills verid points the agent at.
- The verid plugin: tester, coder and reviewer agents that `verid cook` maps to the roles, and a skill for each step. Any other agent can fill a role through `roles`.

```bash
claude plugin marketplace add obra/superpowers-marketplace
claude plugin install superpowers@superpowers-marketplace
claude plugin marketplace add anhtranhai835/verid
claude plugin install verid@verid
```

## Install

```bash
npm install -g @anhtranhai835/verid
```

From a clone: `npm ci`, `npm run build`, `npm link` (or the `bun install --frozen-lockfile`, `bun run build`, `bun link` equivalents). The hooks point at the installed `dist/`, so run `verid cook` again in each project after upgrading, moving the clone, or switching between npm and a clone.

## Quick start

In your own terminal, in the project to guard:

```bash
verid cook     # pick the language, the mode and, in prep and recipe, the drive
verid stock    # remix only: record the tests that already fail
```

Then open Claude Code and say what you want. Every verid message names the next command; `verid menu` says where the project stands.

Commit `.verid/manifest.yaml`, `.verid/.gitignore`, `.claude/commands/verid/` and, in prep and recipe, `.verid/research.md`, `.verid/design.md` and `.verid/plan.md`. Do not commit `.claude/settings.local.json`: it names this machine's verid. A teammate runs `verid cook` once after cloning.

## Modes

| Mode     | Starts from             | verid adds                                                                                                                                                                        |
| :------- | :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prep`   | an idea, no code yet    | research in `.verid/research.md`, a design in `.verid/design.md`, then modules in `.verid/plan.md`, each approved, reviewed and served, last a `product` module of end-to-end ACs |
| `recipe` | a specification         | the same steps, with modules taken from the specification                                                                                                                         |
| `remix`  | existing code and tests | a baseline of the tests that failed before verid                                                                                                                                  |

## Drive: human or auto

In prep and recipe, `drive` in the manifest says who moves the project from module to module; `verid cook` asks after the mode.

| Drive             | Who moves the project                                                                                                                                |
| :---------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| `human` (default) | the developer: `verid order <module>` opens each module, `verid serve <module>` closes it                                                            |
| `auto`            | the agent: it plans, builds and reviews every module, `product` last, and stops only when stuck. Needs the reviewer, tester and coder all in `roles` |

The auto drive:

1. **Ask.** The agent asks the research and design questions and writes `.verid/research.md` and `.verid/design.md`. Until they are signed, production code is locked and the drive does not hold the agent (the usual holds for a red test, a stub or an unrun change still apply).
2. **Sign.** The developer reads both and runs `verid order` (no module) in their own terminal; verid records their sha256. Unless the drive gets stuck, this is the only command the developer types.
3. **Plan.** The agent writes `.verid/plan.md`, ending with `product`, and the reviewer reviews it against the design. A review ends with `Verdict: pass` or `Verdict: fail`; no such line counts as fail. Production code stays locked until the plan passes.
4. **Build.** verid opens the first module not yet served, in plan order. The tester and coder build each AC test-first, the agent commits, the reviewer reviews the module.
5. **Close.** verid closes the module once every AC has a passing test, the last run passed with no change since, the review after the last change says pass, and the git tree is clean from the project folder down (untracked files count, `.claude/settings.local.json` does not). The next module opens; the drive is done when `product` closes last, and a module served after `product` reopens it.

Stop holds the agent every time, saying what comes next, until the drive is done or stuck. `verid menu` and the session-start message show the drive (signed, plan reviewed, modules, counters n/3, next step or why it is stuck); `verid peek` shows the cycle and the next step.

**Limits.** Every loop stops at 3: failed plan reviews, coder rounds per AC (a round ends when the coder stops with a red test naming the AC), failed module reviews, and Stop holds in a row with no progress (tests, plan, commits and counters unchanged). A count resets when its loop passes; the no-progress count, when the outcome changes.

**Stuck** when `.verid/blocked.md` has text (written by the agent when only the developer can answer, or by the developer to pause), a limit is reached, `.verid/research.md` or `.verid/design.md` differs from what was signed, or a served module's plan section was edited or removed. The first time a hook sees `.verid/blocked.md` (any Stop, or any tool call that writes, a Bash `rm` of it included), verid latches the block in `.verid/.state/`, so deleting the file does not clear it; a count at its limit also stays until `verid order`. The last two causes are re-read from the files, so restoring them clears the block. While stuck, production code and tests are locked (`VERID_BURNT_AUTO_STUCK`) and Stop lets the agent stop and tells the developer why, as when done.

**Resume** with `verid order`: it signs again, resets the counts, deletes `.verid/blocked.md` and drops the open module's review. The plan stays approved only if research and design did not change; a served module whose plan section changed is reopened, and one the plan dropped is forgotten.

**Refusals.** With no module open, production code is locked (`VERID_BURNT_AUTO_NO_MODULE`). In auto, `verid order <module>` and `verid serve` refuse (`VERID_BURNT_AUTO_ORDER_MODULE`, `VERID_BURNT_AUTO_SERVE`), and `verid order` refuses while research or design is missing (`VERID_BURNT_RESEARCH_MISSING`, `VERID_BURNT_DESIGN_MISSING`).

**Esc and switching.** Press Esc to ask the agent something: Stop does not run on an interrupt, and holds the agent again after it answers. To switch drive, edit `drive:` in `.verid/manifest.yaml`. Served modules stay served; human to auto needs the signing and a plan review; auto to human needs `verid order <module>` for the open module.

## Commands

| Command                      | Who                       | What it does                                                                                                                                             |
| :--------------------------- | :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verid cook`                 | developer                 | sets verid up for this project and machine; offers an older manifest its new defaults                                                                    |
| `verid taste`                | agent                     | runs the tests; only these runs count as evidence                                                                                                        |
| `verid peek`                 | anyone                    | the cycle, the next step, and why the last run did not count                                                                                             |
| `verid menu`                 | anyone                    | research, modules with their AC coverage, open questions, the next step                                                                                  |
| `verid stock`                | developer                 | remix: records the failing tests as the baseline                                                                                                         |
| `verid order [module]`       | developer                 | prep, recipe: approves a module of `.verid/plan.md`, signing `.verid/design.md` too; auto: signs research and design, and resumes after a stop           |
| `verid serve <module>`       | developer                 | prep, recipe, human drive only: closes the open module once every AC passes and the reviewer reviewed it after the last change; prints the review's path |
| `verid garnish`              | developer                 | opens production code for a conversation that only refactors                                                                                             |
| `/verid:tip <reason>`        | developer, in Claude Code | asks to let the action just blocked through, with a one-time code                                                                                        |
| `/verid:confirm <code>`      | developer, in Claude Code | lets that exact action through once                                                                                                                      |
| `/verid:peek`, `/verid:menu` | developer, in Claude Code | what `verid peek` and `verid menu` show, to you only                                                                                                     |

`verid cook` takes `--mode prep|recipe|remix`, `--drive human|auto`, `--lang vi|en`, `--test-cmd` (your own test command) and repeatable `--src`/`--tests` globs, and asks when given none in a terminal. Once a manifest exists, `--mode`, `--drive`, `--test-cmd`, `--src` and `--tests` are ignored with a note: edit `.verid/manifest.yaml` by hand. The developer's commands refuse to run inside Claude Code, and the hook keeps them out of the agent's Bash.

## How it works

### Three rules

1. **No production code without a failing test first.** Production code is locked while the cycle is RAW, and in prep and recipe while no module is approved. While a test fails, the tests are frozen.
2. **Evidence before claims.** Only a `verid taste` run whose exit code and JUnit report agree counts. In the human drive the agent cannot stop while the last run fails or after a change no run has seen; the auto drive holds every Stop itself.
3. **Only the developer opens an exception.** `/verid tip` works only with a person at the keyboard, never from a subagent or `claude -p`. Each exception lets one action past one rule, once: a command two rules block needs two.

### Roles

Claude Code puts an `agent_type` in each subagent's tool calls; `roles` maps agent types to roles. With both a tester and a coder, the work is split:

| Who writes                                 | Production code   | Tests              | Other files (docs, config, `.verid/*.md`) |
| :----------------------------------------- | :---------------- | :----------------- | :---------------------------------------- |
| the reviewer                               | `ROLE_READ_ONLY`  | `ROLE_READ_ONLY`   | `ROLE_READ_ONLY`                          |
| split: the coder                           | by the TDD gate   | `ROLE_TESTER_ONLY` | allowed                                   |
| split: the tester                          | `ROLE_CODER_ONLY` | by the TDD gate    | allowed                                   |
| split: the main conversation, other agents | `ROLE_CODER_ONLY` | `ROLE_TESTER_ONLY` | allowed                                   |
| not split: anyone but the reviewer         | by the TDD gate   | by the TDD gate    | allowed                                   |

- A call with no `agent_id` is the main conversation, even under `claude --agent X`. Role rules come before the TDD gate: the role says who, the cycle says when.
- When the reviewer stops with a module open, verid records its final report under `.verid/.state/reviews/`; a later code or test write, or a new `verid order`, voids it.
- A subagent that wrote code or a test is held once if it stops while a test fails, a stub is open or a change is unrun; the tester is not held for a failing test or a stub.

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

| Rule                               | Overridable | Covers                                                                                                              |
| :--------------------------------- | :---------- | :------------------------------------------------------------------------------------------------------------------ |
| `VERID_BURNT_STATE_PROTECTED`      | no          | reading or writing `.verid/.state/`                                                                                 |
| `VERID_BURNT_SECRET_PROTECTED`     | no          | secret files: `.env*` (not templates), keys, certificates, `.ssh/`, `.npmrc`…                                       |
| `VERID_BURNT_TRANSCRIPT_PROTECTED` | no          | Claude Code transcripts in `~/.claude/projects/`                                                                    |
| `VERID_BURNT_HOOK_PROTECTED`       | no          | writing `.claude/settings*.json`, `.claude/agents/`, `.claude/plugins/`, `.claude/commands/verid/`, verid's `dist/` |
| `VERID_BURNT_MANIFEST_PROTECTED`   | yes         | writing `.verid/manifest.yaml`                                                                                      |
| `VERID_BURNT_BASH_NESTED_CLAUDE`   | yes         | Bash starting a nested `claude`                                                                                     |
| `VERID_BURNT_BASH_DEVELOPER_ONLY`  | yes         | Bash naming `CLAUDECODE` or verid's hook, or running a developer command                                            |
| `VERID_BURNT_SHELL_UNSUPPORTED`    | yes         | PowerShell, or any other tool whose input has a `command`                                                           |
| `VERID_BURNT_ROLE_READ_ONLY`       | yes         | any write by the mapped reviewer                                                                                    |
| `VERID_BURNT_ROLE_TESTER_ONLY`     | yes         | split: a test written by anyone but the tester                                                                      |
| `VERID_BURNT_ROLE_CODER_ONLY`      | yes         | split: production code written by anyone but the coder                                                              |
| `VERID_BURNT_PLAN_NO_RESEARCH`     | yes         | writing `.verid/plan.md` before `.verid/research.md` exists                                                         |
| `VERID_BURNT_PLAN_NO_DESIGN`       | yes         | writing `.verid/plan.md` before `.verid/design.md` exists                                                           |
| `VERID_BURNT_PLAN_NOT_APPROVED`    | yes         | production code while no module is open (prep, recipe)                                                              |
| `VERID_BURNT_AUTO_NO_MODULE`       | yes         | auto: production code while no module is open                                                                       |
| `VERID_BURNT_AUTO_STUCK`           | yes         | auto: production code and tests while the drive is stuck                                                            |
| `VERID_BURNT_TDD_NO_FAILING_TEST`  | yes         | production code while the cycle is RAW                                                                              |
| `VERID_BURNT_TDD_TEST_FROZEN`      | yes         | a test while the cycle is COOKING                                                                                   |

The rules cover file tools, Bash (its plain write targets are judged like a Write) and MCP tools. Any unexpected error blocks the call.

## manifest.yaml

```yaml
schemaVersion: 1
mode: remix # prep | recipe | remix
roles: # optional: agent types, as Claude Code reports them, for each role
  reviewer: ["verid:reviewer"]
  tester: ["verid:tester"] # with both a tester and a coder, the work is split
  coder: ["verid:coder"]
drive: human # human | auto
repos:
  - path: .
    # test_cmd: make test JUNIT={junit}   # optional: without it verid finds the runners
    source_globs: ["**"] # production code
    test_globs: ["**/test/**", "**/*.test.*", …] # tests and runner config
    ignore_globs: ["**/*.md", "**/*.json", …] # never production code
    e2e_globs: ["**/e2e/**", "**/*.e2e.*"] # end-to-end tests
    timeout_sec: 100 # optional
```

- Only the developer edits the manifest; `verid cook` writes the defaults, where every file is code unless it is a test, a document, data, config, a build file or a tool's folder.
- A name in `roles` has one role, and a tester needs a coder. Without `roles`, nobody is held to a role and `verid serve` refuses for want of a reviewer. `drive: auto` without prep or recipe and all three roles is refused.
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

**Bash and other tools**

- Bash is matched as text: variables, `$(...)`, `$'...'`, globs, scripts, `cd` then a relative path, `git checkout`/`restore`/`apply`, `prettier --write` and run-time paths get through. There is no Bash allowlist, on purpose.
- The same matching blocks some harmless commands (`jq '.key'`, a commit message containing `secret`); `/verid tip` passes them.
- Other shells are known only by the name `PowerShell` or a top-level `command` key: a command in an array, nested, or under `cmd`/`script` gets through; an unrelated `command` is blocked by mistake.
- MCP tools are judged by path-like keys and a name that says they write: other keys and silent writers get through; a remote path may be blocked by mistake.
- Grep and Glob over a folder can read the secrets in it; only the secret file itself is blocked.
- Symlinks and junctions resolve only for the parts of a path that exist, so a Windows 8.3 short name of a new file can slip past.

**Evidence and the cycle**

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

- Roles go by the payload's `agent_type`: if Claude Code renames or drops it, subagents look like the main conversation, so split code and test writes are blocked, `verid serve` refuses without a reviewer, and auto fails closed.
- Names in `roles` match exactly: an agent its plugin renames loses its role, failing closed (writes blocked, `verid serve` refuses).
- The verid plugin installs apart from the npm package: until it is installed, `roles` names missing agents (writes blocked, `verid serve` refuses), and updating only one lets them drift apart.
- Split, the tester can still weaken a test in RAW or PLATED: the split only stops the coder.
- The tester and coder have Bash, and only the hook keeps each to its part. The split is on by default, so the main conversation no longer writes code or tests.
- Agents from other plugins, or ClaudeKit's, mapped in `roles` do not know verid: only the hook's refusals guide them. verid's own agents do know it.
- An agent name with no namespace (`general-purpose`, or one in `~/.claude/agents/` such as ClaudeKit's) is replaced by a `.claude/agents/<name>.md` in a freshly cloned repo; `verid:*` names are not. The hook stops the agent creating that file, not one already there.
- verid's and superpowers' skills are prompts: the hook cannot tell whether the agent uses them.

**Auto drive**

- The reviewer writes its own verdict: verid reads only the `Verdict:` line, not how closely it read, and no person reads a review before a module closes.
- The agent writes the plan and the reviewer reviews it; no person signs it.
- A report is filed as a plan or module review by where the drive stands, not by what the reviewer was asked to review.
- The dispatching agent writes the reviewer's prompt, so verid does not know what it was shown; a background reviewer still running while code changes records its report as after the last change.
- A coder round counts by the AC named in the red test when the coder stops; a red test naming no AC is not counted.
- Git is checked only for a clean tree from the project folder down, not for what a commit holds or which module it belongs to.
- A git error in a repo (dubious ownership, a corrupt index or config), or once signed inside git a missing or broken repo, counts as uncommitted, so the module waits; the check is skipped only if the project was outside git (or git not on `PATH`) at signing, and dropping git takes a new `verid order`.
- Files git itself hides are not uncommitted: `.gitignore`, `.git/info/exclude` and global ignore (`core.excludesFile`) entries, `assume-unchanged` or `skip-worktree` files, submodules with `ignore` set.
- The agent cannot name `.claude/settings.local.json` in Bash, so it usually commits with `git add -A`; Claude Code usually lists that file in the global gitignore, and without that line it can be committed.
- Claude Code does not run Stop on Esc: an interrupt is not counted as no progress, but the agent is not held either.
- `.verid/blocked.md` is the agent's own word: it can report a block that is not there (but then stops for good).
- A block latches only when a hook sees `.verid/blocked.md` (a Stop, or a tool call that writes): a script that deletes it first and does not look like a write, such as `node cleanup.js`, leaves no block.
- "No progress" goes by what the hook sees: a Bash write it does not recognise is not progress.
- The no-progress count compares each Stop with the one before only: churn without real progress (a flaky test, a byte of `.verid/plan.md` toggled, empty commits) resets it, so that loop is not capped.
- While stuck, a code write needs two `/verid tip`s (the stuck lock, then no open module), like any call two rules block.
- Auto holds every Stop whatever `stop_hook_active` says: if Claude Code changes what that flag means, the agent may stop mid-drive.

**Runners**

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
- Globs ignore case on every platform.

**Self-protection and overrides**

- Only verid's `dist/` is protected: editing `i18n/*.json` changes messages, not decisions.
- The agent cannot write agents or plugins but can write skills (`.claude/skills/`); hooks in skill or subagent frontmatter and in plugins run unchecked and can rewrite tool input after verid judged it.
- Bash mentioning `.claude/agents` or `.claude/plugins` is blocked even to read (use Read or Glob); the developer, not the agent, edits the project's subagents.
- Bash mentioning any file named `manifest.yaml` is blocked even to read, such as `cat .verid/manifest.yaml`: use Read, or `/verid tip`.
- Deleting `.verid` blocks every tool call.
- Developer commands and `CLAUDECODE` are kept out of the agent's Bash by name only: through a script, a variable or a run-time string the agent could record its own baseline, approve or close its own module, or in auto sign the design or resume a stuck drive.
- The agent's Bash inherits `CLAUDE_CODE_SESSION_ATTENDED`: commands naming verid's hook are blocked, but through a copy of the hook, a script or a built path the agent could grant itself an override.
- A pseudo-terminal tool such as `node-pty` could start a nested session that Claude Code treats as attended.
- The confirmation code stays in the transcript on disk, which the agent is blocked from reading.
- Overrides rely on Claude Code's internal `CLAUDE_CODE_SESSION_ATTENDED`: if it is renamed, overrides stop and everything stays blocked.
- An override lifts only the rule it names; the other rules, the role rules and the TDD gate still judge the call, and each that denies needs its own `/verid tip`.
- What verid cannot read gets through once its shell is allowed: an allowed PowerShell call is judged on nothing else, and an MCP tool with a `command` only on the paths its input names.
- The interactive setup needs a real terminal and is tested with a simulated one.
- Status lines, file paths and parser details stay in English; a hook payload that is not JSON gets both languages.
- Under heavy load a blocked call may get `VERID_BURNT_LOCK_TIMEOUT`: still blocked, but not counted.

## Development

```bash
npm test             # build, then unit and end-to-end tests
npm run typecheck
npm run format
```

There is no CI: `test/e2e/hook.e2e.test.ts` replays payloads recorded on Windows, so run `npm test` on Windows before each commit.

## Credits

verid stands on two projects:

- **[superpowers](https://github.com/obra/superpowers)** by Jesse Vincent: verid's cycle is the RED-GREEN-REFACTOR loop of its `test-driven-development` skill, and "evidence before claims" comes from `verification-before-completion`. verid adds the hook that enforces them.
- **[andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills)** by forrestchang: think before coding, simplicity first, surgical changes, goal-driven execution.

verid is an independent project, not affiliated with either.

## License

MIT, see [LICENSE](./LICENSE).
