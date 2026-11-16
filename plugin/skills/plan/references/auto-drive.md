# Planning in the no-brain drive

verid signs research/spec/design itself; nobody approves the plan. Write the plan,
then give the reviewer its path and the design path for a plan review. Follow
verid:review's verdict format. Fix findings and repeat until it passes; a failed review
never stops the drive. Passing review opens the first module automatically.

Resolve every question yourself with the recommended answer and record why; when the
answer changes the design, update `.verid/design.md` too (verid signs it again and the
plan goes back to review). Use `.verid/blocked.md`, written by main, only when the work
truly cannot go on without something only a person has, such as a credential; the agent
may stop then, and deleting the file resumes the drive. Editing an accepted plan needs
review again; a served module whose section changed opens again. Module orders and serves
are automatic; Git handoff stays advisory.
