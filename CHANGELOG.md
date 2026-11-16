# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/) and
[Semantic Versioning](https://semver.org/). Tags are named `vX.Y.Z`.

## [1.0.1] - 2026-11-16

### Fixed

- `verid cook` no longer repeats the question line when an option wraps in a narrow terminal.
- A read-only shell command split over several lines (for example Codex reading installed skills) is no longer denied as a protected write.

## [1.0.0] - 2026-11-16

### Added

- Hook-enforced TDD harness for Claude Code and Codex, with recorded test evidence and review gates.
- Module workflows with `verid order` for approval and `verid serve` for completion.
- `verid mockup` to record the developer's UI mockup choice before ordering a module.
- Public npm distribution as `@anhtranhai835/verid` under MIT. The workflow uses the CLI and has no web board.

[1.0.1]: https://github.com/anhtranhai835/verid/releases/tag/v1.0.1
[1.0.0]: https://github.com/anhtranhai835/verid/releases/tag/v1.0.0
