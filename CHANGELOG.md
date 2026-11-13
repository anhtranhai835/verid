# Changelog

All notable user-visible changes to verid. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). Tags are named `vX.Y.Z` from 2.0.0 on; the older
tags `1.0.0` and `1.2.0` keep their names.

## [Unreleased]

### Removed

- The Antigravity provider: `--provider antigravity`, `verid setup-antigravity` and the plugin in
  `plugin/antigravity`. A manifest that lists `antigravity` under `providers` no longer loads;
  remove the entry and run `verid cook` again. Claude Code and Codex are unchanged.

### Changed

- `verid cook` asks for the provider right after the language on a new project, the one installed
  on this machine first and each choice saying whether its command was found, instead of picking
  Codex silently when `claude` is not on PATH.
- On the no-brain board, only the crew member's own pixels move and glow while they work; the
  room behind them and their name tag stay still.

### Fixed

- The board's chat with Codex no longer stops at the second message outside a Git repository
  Codex trusts: a resumed turn passes `--skip-git-repo-check` too.
- A `|` in an acceptance criterion no longer splits its row of the scaffolded trace table: it is
  written as `\|`.

## [2.1.0] - 2026-11-12

### Added

- `verid usage`, with token totals on board cards; the audit log records usage counts and
  provider tokens.
- `verid context`, a task packet that task prompts point at.
- A compact review packet: `verid menu --commits --file --compact`.
- Module dossiers are prefilled from the plan and spec.
- Skills and agents can be opted into per project.
- The no-brain board shows the run as a pixel-art restaurant crew, with a waiter that explains
  what needs you and suggests one next step.
- Mode `reheat` rewrites a read-only legacy system unit by unit through an adapter plugin
  (`verid reheat inventory|extract|gate`), refuses every write into the legacy repo, and closes a
  unit only on a parity record the developer signed. See [docs/reheat-mode.md](docs/reheat-mode.md).

### Changed

- verid ships as a `.tgz` on a private GitHub Release instead of the npm registry. The one-line
  installers need the GitHub CLI signed in with read access to the repository. A pushed `vX.Y.Z`
  tag builds, tests and releases the package; see [docs/releasing.md](docs/releasing.md).
- Agent-facing messages and repeated denials are shorter.
- `serve` says the latest review failed when it refuses a failed review.
- The missing-manifest hint is corrected, the command table is shorter, and commands show the
  next step.
- The instruction block routes bugs to the debugging skill.
- `verid cook` in a terminal asks only the language, the mode and the drive, then shows the
  provider, layout and test runner it found; "Change settings" asks the rest. Its last line is
  the one sentence to say to the agent: "what's next?". Bare `verid` lists `cook`, `doctor` and
  `menu` first, the gate commands as a second group.
- The drives are renamed: `big-brain` (was `human`) and `no-brain` (was `ai`). The older names
  `human`, `ai` and `auto` still load and `--drive` still takes them; see "Upgrading" in
  [docs/installation.md](docs/installation.md).

### Fixed

- Board, task-session and board-chat messages follow the project's language; they were
  Vietnamese in every project.
- `verid setup-codex` and `verid cook --provider codex` work when another user installed verid
  (`sudo npm install -g`): the reviewer's agent file then goes beside Codex's own config.
- The context-engineering document reader reports a blank PDF page as a page without text
  instead of a failed extraction.
- The README install step uses the GitHub Release installer; the package is not on npm.
- The test suite passes on Linux and macOS, which the release workflow requires.

## [2.0.0] - 2026-11-10

### Added

- Human and AI drives, explicit monorepo and workspace setup, persistent task priorities.
- `verid upgrade --dry-run` and `verid upgrade --yes` migrate 1.x projects safely.

### Changed

- Prep and recipe are unified around module dossiers and the board.

### Breaking

- The human drive requires a fresh session per task.
- Pending modules require complete dossiers.
- Repo-pinned runtimes in `.verid/hooks/` must be updated after upgrading the package. See
  "Upgrading from 1.x" in [docs/installation.md](docs/installation.md).

## [1.2.0] - 2026-11-09

### Added

- Antigravity as a first-class provider.
- A local kanban task board with task sessions, chat with the selected task's AI, and one task
  per AI session.
- Modular cook, repo resources and bilingual guides.
- The repo harness runs without a global verid install.
- Skills and agents are routed with bounded document context; every skill is reachable on each
  provider.

### Changed

- The instruction block lives in `AGENTS.md` and `CLAUDE.md` imports it.
- Bundled skills are named after verid and resolve without superpowers installed.

### Fixed

- Review freshness, runner discovery and bundled skills.

### Removed

- Skill test suites are no longer shipped in the package.

## [1.1.0] - 2026-10-23

### Added

- The auto drive: answer research and design once and sign with `verid order`; the agent plans,
  builds and reviews every module, product last, and stops only when stuck.

## [1.0.0] - 2026-11-05

Initial release of the evidence-verified, hook-enforced TDD harness for Claude Code and Codex.

[Unreleased]: https://github.com/anhtranhai835/verid/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/anhtranhai835/verid/releases/tag/v2.1.0
[2.0.0]: https://github.com/anhtranhai835/verid/commit/dd6d7bb
[1.2.0]: https://github.com/anhtranhai835/verid/releases/tag/1.2.0
[1.1.0]: https://github.com/anhtranhai835/verid/releases/tag/v1.1.0
[1.0.0]: https://github.com/anhtranhai835/verid/releases/tag/1.0.0
