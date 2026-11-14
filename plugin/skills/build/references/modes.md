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

In no-brain drive, follow the next menu step without asking; verid opens modules after
plan review. Failed rounds and reviews never stop the drive: from the second failed
review, find the root cause with the debugger first. Decide open questions yourself and
record why. Only a blocker no agent can clear (a missing credential, say) goes in
`.verid/blocked.md`; the agent may stop, and deleting the file resumes the drive.
With `stations: 1`, the drive creates no branches and waits for no merge.
With parallel stations, read `../../plan/references/stations.md`; retry counters
and blockers stay local, and the developer closes each served station.
