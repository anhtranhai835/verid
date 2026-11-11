# Parallel stations

A station gives one independent module a Git worktree, branch, TDD cycle and fresh
provider session. Claude Code, Codex and Antigravity use the same gates. Stations
currently require a prep or recipe project at the root of one Git repository, with
`repos.path: .`. Multi-repository workspaces are not supported.

Declare ownership before the first AC in each parallel module:

```markdown
## Module: identity

Artifacts: .verid/artifacts/03-modules/identity
Boundary: src/identity/**, test/identity/**
Depends: foundation

- AC-1: a member signs in with valid credentials (REQ-1)
```

`Boundary` uses the existing manifest glob syntax (`*`, `**`, `?`), relative to
the project. No absolute paths, backslashes or `..`. Declare shared files such as
barrel exports and configuration too. Possible glob intersections are rejected
conservatively: split shared work into a prerequisite module. Every dependency
must be served and integrated before opening the station.

Commit the setup, plan, dossiers and pinned runtime first. In your own terminal:

```sh
verid order identity
verid station identity
verid order billing
verid station billing
verid station list
```

Open a fresh provider session at each printed path, typically
`../<project>.stations/<module>`, on `feat/<module>`. On Codex, trust the worktree
and its hooks through the provider's usual UI. Antigravity must open that worktree
as its workspace. Run `verid doctor` there before starting. Keep each writer and
reviewer inside its station; dispatch into worktrees from one parent conversation
is not supported yet.

Each station copies only its module's approval; evidence, reviews and session
ownership start fresh. The inherited `CLAUDE_PROJECT_DIR` cannot redirect a
registered station to the primary tree. The primary tree reserves the files of
every open station. A session cannot move between stations, even after a clear or
compaction. Use file tools for edits; shell commands are restricted to simple local
Git inspection/commits and `verid taste`, `peek`, `menu`, `context`, `usage`.
Code, tests and independent reviews retain their existing gates.

Run TDD and serve inside the station, then commit all its work. From the clean
original branch in the primary tree:

```sh
verid station close identity
verid station close billing
```

Close checks approval freshness and committed file ownership, squashes the station,
and runs `taste` on the merged files. Only a passing merged run records the
integration commit and marks the parent module done. A failed run or conflict keeps
the station and leaves the parent module incomplete; conflict paths are printed.
An initially clean failed merge is rolled back. Concurrent edits or interrupted
integration require inspection in your terminal; `doctor` reports unfinished stages.
No conflict is resolved automatically. Local evidence is archived in the primary
tree's private state before cleanup; usage events are retained in its audit log.
Cleanup failures retain a registry entry;
retry close after releasing Windows file locks. Branches remain for inspection.

Up to three stations may be open. For no-brain drive set `stations: 2` or `3` in
the manifest before signing with `verid order`. Omission means `1`, retaining the
serial workflow. After independent plan review, the drive opens eligible modules
in queue order; each station owns its retry counters, so one stuck station does
not stop another. `product` stays on the primary tree until every integration
finishes. Close remains a developer command.

The board shows each station's own TDD state on its Cooking card. A served station
stays there until integration succeeds. No-brain chat has a Conversation selector
for the project and each station; transcripts and stop buttons are separate,
with at most `stations` provider processes at once. After the coordinator finishes
a message, the board can start the eligible station sessions. Closing the board
stops its child processes.

`verid doctor` reports orphan station worktrees, missing branches/worktrees and
changed approvals. Keep the registry and local state private and ignored. For an
interrupted opening, inspect `git worktree list`, remove only the failed station
worktree/branch in your terminal, and repair the matching registry entry before
retrying. Do not delete another station's state to reset its gates.

Parallel sessions consume additional model context. Token/time comparisons and
the real-provider walkthrough are pending; the default remains serial.

[Tiếng Việt](stations.vi.md)
