## Verid TDD Harness (Antigravity Edition)

> **Scope Guard:** Apply these rules **only** when the active workspace contains a `.verid/` directory. In workspaces without `.verid/`, ignore this block completely.

### Token & Context Discipline

- **Never re-read `AGENTS.md` or `GEMINI.md` via `read_file`** — Antigravity already injects workspace and plugin rules into your system context.
- **Superpowers De-duplication:** Inside `.verid/` workspaces, `verid-*` skills supersede overlapping `superpowers` skills (`verid-ba` replaces `brainstorming`, `verid-plan` replaces `writing-plans`, `verid-build` replaces `test-driven-development` & `subagent-driven-development`, `verid-debugging` replaces `systematic-debugging`, `verid-review` replaces `requesting-code-review`). Never load both in the same turn.
- **Single-Writer Build Loop (`main`):** Write both failing tests (in `RAW`) and minimal production code (in `COOKING`) directly in the main conversation. Do **not** spawn separate `tester` or `coder` subagents per AC unless the user explicitly asks for parallel/split subagents.
- **Use `verid peek` inside the TDD loop** (360 chars) instead of `verid menu` (up to 6,400 chars). Only run `verid menu` when planning or reviewing module-wide status.
- **Progressive Skill Loading:** Load only the single `verid-*` skill matching the current phase (`verid-onboard`, `verid-ba`, `verid-design`, `verid-plan`, `verid-build`, `verid-debugging`, `verid-review`, or `verid-router` for domain packs). In `mode: remix`, skip `spec.md`/`design.md`/`plan.md` ceremony and go straight from `research.md` to `RAW -> COOKING -> PLATED`.

### Hook-Enforced TDD Cycle (`RAW -> COOKING -> PLATED`)

- **`RAW`:** Production code is locked. Write one failing test named with its `AC-n` / `AC_n` code, then run `verid taste` (or `node .verid/verid.mjs taste` if `.verid/verid.mjs` exists).
- **`COOKING`:** Tests are frozen. Write the minimum production code to pass, then run `verid taste`.
- **`PLATED`:** All tests pass. Refactor without new behaviour and re-run `verid taste`; the next failing test reopens `RAW`.
- **Independent Review:** When all module ACs pass, run `verid menu --commits --file` to generate `.verid/review/work.md`, then call `invoke_subagent` with `TypeName: "verid-reviewer"` (and `TypeName: "verid-security"` if `roles.security` is mapped separately). Never write to `.verid/.state/`, `.verid/manifest.yaml`, or `.verid/docs/`.
- **Developer-Only Commands:** Never run `verid cook`, `upgrade`, `stock`, `order`, `serve`, `garnish`, `halt`, `resume`, or `board` yourself; ask the developer to run them in their terminal.
