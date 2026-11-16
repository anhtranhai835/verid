# After a failed review

A finding is a claim to check, not an order. The verdict stays what the reviewer wrote; the
hook reads it from the report and nothing here changes it.

1. Read the whole report before touching code. If a finding is unclear, ask the developer
   first: findings are often related, and a half-understood fix is a second bug.
2. Check each Critical and Important finding against the code at the `file:line` it names
   and against the AC it cites.
3. A finding that holds: the mapped tester (main on Codex) writes a failing test carrying the
   AC code, then the coder fixes it under verid:tdd. One finding at a time; `verid taste`
   after each.
4. A finding that is wrong, or that asks for behaviour no AC covers: tell the developer, with
   the code or test that shows it. The developer decides. Never change code only to satisfy a
   finding, and never dispatch reviewers again and again to collect a pass.
5. Minor and Advisory findings do not fail a review. Fix one only when it is in the module's
   scope; otherwise list it for the developer.
6. Write what was tried and failed under `Tried:` in `.verid/log/<module>.md`.
7. Generate a fresh packet with `verid menu --commits --file` and dispatch a fresh reviewer.
   When security is mapped, repeat the reviewer first, then security.
