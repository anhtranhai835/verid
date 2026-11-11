# Building in a workspace, in remix mode and in no-brain drive

## Workspace

In a workspace, give each writer the repo path and repo-relative globs. Use the
frontend repo for e2e tests unless the design chooses a dedicated e2e repo. Run
`verid taste` at the workspace root.

## Remix

In remix mode, the developer records pre-existing failures with `verid stock`.
Characterize untested behaviour before changing it; a known bug needs a regression
test, rather than a characterization that blesses the bug. Return an untestable
boundary to the developer.

## No-brain drive

In no-brain drive, follow the next menu step; verid opens modules after plan review.
Three failing coder rounds per named AC, failed reviews, or idle Stop holds leave
the drive stuck. A blocker or a question needing the developer goes in
`.verid/blocked.md`; the developer settles it and runs `verid order` to resume.
The drive creates no branches and waits for no merge.
