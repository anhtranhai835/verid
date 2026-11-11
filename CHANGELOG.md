# Changelog

All notable user-visible changes to verid. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). Tags are named `vX.Y.Z` from 2.0.0 on; the older
tags `1.0.0` and `1.2.0` keep their names.

## [Unreleased]

### Added

- `verid usage`, with token totals on board cards; the audit log records usage counts and
  provider tokens.
- `verid context`, a task packet that task prompts point at.
- A compact review packet: `verid menu --commits --file --compact`.
- Module dossiers are prefilled from the plan and spec.
- Skills and agents can be opted into per project.

### Changed

- Agent-facing messages and repeated denials are shorter.
- `serve` says the latest review failed when it refuses a failed review.
- The missing-manifest hint is corrected, the command table is shorter, and commands show the
  next step.
- The instruction block routes bugs to the debugging skill.

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

[Unreleased]: https://github.com/anhtranhai835/verid/compare/1.2.0...HEAD
[2.0.0]: https://github.com/anhtranhai835/verid/commit/dd6d7bb
[1.2.0]: https://github.com/anhtranhai835/verid/releases/tag/1.2.0
[1.1.0]: https://github.com/anhtranhai835/verid/releases/tag/v1.1.0
[1.0.0]: https://github.com/anhtranhai835/verid/releases/tag/1.0.0
