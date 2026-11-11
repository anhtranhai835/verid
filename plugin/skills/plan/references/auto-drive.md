# Planning in the no-brain drive

After the developer signs research/spec/design, propose and write the plan, then give
the reviewer its path and the design path for a plan review. Follow verid:review's
verdict format. Fix findings and repeat; a third failed or missing verdict leaves
the drive stuck. Passing review opens the first module automatically.

Resolve questions within the signed design using the recommended answer and
record why. Questions changing the design or needing the developer go in
`.verid/blocked.md`, written by main, because a planner cannot record that block.
The developer settles it and runs `verid order` to resume. Editing an accepted
plan needs review again; changing a served module leaves the drive stuck.
Module orders and serves are automatic; Git handoff stays advisory.
