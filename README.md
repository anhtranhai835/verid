# verid

Evidence-verified, hook-enforced TDD harness for [Claude Code](https://claude.com/claude-code).

> The agent does the work. verid verifies it. The developer approves.

verid works on two layers:

- **Enforcement layer:** a single fail-closed Claude Code hook backed by a pure policy engine. The rules live in code, not in the prompt.
- **Prompt layer (planned):** bilingual (vi/en) skills, agents and templates that drive the TDD loop and build on the [superpowers](https://github.com/obra/superpowers) skills.

## Status

**Phase 1 — hook-enforced TDD cycle.** The hook enforces the RED-GREEN-REFACTOR cycle, and `verid test` records each test run as evidence. There is no `verid init` yet, so setup is manual.

What the hook enforces:

| Rule                           | Overridable | Covers                                                                                                          |
| ------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `VERID_E_STATE_PROTECTED`      | no          | Reading or writing `.verid/.state/**`                                                                           |
| `VERID_E_SECRET_PROTECTED`     | no          | Secret files: `.env*` (except templates), keys, certificates, `.ssh/**`, `.npmrc`, `*credentials*`, `*secret*`… |
| `VERID_E_TRANSCRIPT_PROTECTED` | no          | Claude Code transcripts in `~/.claude/projects/**`                                                              |
| `VERID_E_MANIFEST_PROTECTED`   | yes         | Writing `.verid/manifest.yaml`                                                                                  |
| `VERID_E_BASH_NESTED_CLAUDE`   | yes         | Bash starting a nested `claude` session                                                                         |
| `VERID_E_TDD_NO_FAILING_TEST`  | yes         | Writing production code while the TDD cycle is RED (only when a manifest exists)                                |

Every denial is counted in state and written to a hash-chained audit log. Any unexpected error on `PreToolUse` blocks the tool instead of letting it run.

A Claude Code hook is not an OS sandbox. The Bash rules match strings, and the TDD gate only sees file-editing tools, so both can be bypassed. See the known limitations in [docs/system-architecture.md](docs/system-architecture.md).

### The TDD cycle

This is the cycle from superpowers' `test-driven-development` skill, with its rule enforced: no production code without a failing test first. `verid test` runs the manifest's test command, reads its JUnit report, and moves the cycle only when the exit code and the report agree:

| State    | Write production code | Write a test   | `verid test` fails | `verid test` passes |
| -------- | --------------------- | -------------- | ------------------ | ------------------- |
| RED      | blocked               | allowed        | → GREEN            | stays RED           |
| GREEN    | allowed               | allowed, → RED | stays GREEN        | → REFACTOR          |
| REFACTOR | allowed               | allowed, → RED | → GREEN            | stays REFACTOR      |

Changing a test after it was seen failing sends the cycle back to RED, so the agent has to watch it fail again. A test weakened until it passes therefore leaves production code locked. `verid status` shows the current state and the next step. See [ADR-0008](docs/adr/0008-hook-enforced-tdd-cycle.md).

## Quick start

Requires Node.js 22 or newer.

```bash
npm install
npm run build        # bundles dist/hook.js and dist/cli.js (the `verid` command)
```

In the project you want to guard:

1. Create `.verid/.state/state.json` containing `{"schemaVersion":1}`.
2. Register `node <path-to-verid>/dist/hook.js` for `PreToolUse` (matcher `*`, with `"onFailure": "block"`), `UserPromptSubmit`, `Stop` and `SessionStart` in `.claude/settings.json`.
3. To turn on the TDD cycle, create `.verid/manifest.yaml`. Only the developer can edit it:

   ```yaml
   schemaVersion: 1
   repos:
     - path: .
       test_cmd: npx vitest run --reporter=junit --outputFile={junit}
       source_globs: ["src/**"]
       test_globs: ["test/**"]
   ```

4. The agent runs `node <path-to-verid>/dist/cli.js test` (or `verid test` after `npm link`) to record a run, and `verid status` to see where it is.

The full settings file and a step-by-step check are in [docs/manual-hook-checklist.md](docs/manual-hook-checklist.md).

### Overriding a blocked action

Only a developer typing in an interactive session can override, and only for overridable rules:

1. `/verid allow <reason>` shows you a risk warning with a one-time confirmation code. The agent never sees it.
2. `/verid confirm <code>` allows that exact blocked action once.

Overrides are rejected from subagents and `claude -p` sessions. See [ADR-0007](docs/adr/0007-two-step-override-attended-session.md).

## Development

```bash
npm test             # build, then unit and end-to-end tests
npm run typecheck
npm run format
```

The end-to-end tests spawn the real `dist/hook.js` and `dist/cli.js`. The hook tests replay payloads recorded from Claude Code on Windows, so `test/e2e/hook.e2e.test.ts` currently passes only there. The TDD tests build their paths per platform and run anywhere.

## Documentation

Design docs are written in Vietnamese:

- [System architecture](docs/system-architecture.md), including known limitations
- [Code standards](docs/code-standards.md)
- [Architecture decision records](docs/adr/)
- [Manual hook checklist](docs/manual-hook-checklist.md)

## Inspiration

verid stands on the shoulders of two projects:

- **[superpowers](https://github.com/obra/superpowers)** by Jesse Vincent — a skills library that pushes Claude Code through brainstorm, plan, test-driven development and review. verid's TDD cycle is the RED-GREEN-REFACTOR loop of its `test-driven-development` skill, and its "evidence before claims" comes from `verification-before-completion`. verid adds the hook that makes the loop enforced instead of advised, and the prompt layer will build on the skills themselves.
- **[andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills)** (`karpathy-guidelines`) by forrestchang — guidelines derived from Andrej Karpathy's observations on LLM coding pitfalls: think before coding, simplicity first, surgical changes, goal-driven execution.

verid is an independent project and is not affiliated with either of them.

## License

[MIT](LICENSE) © 2026 Anh Tran
