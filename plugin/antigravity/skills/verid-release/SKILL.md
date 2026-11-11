---
name: verid-release
description: Use after verid serve closes a module, to fill its release record with rollout, rollback, migrations and delivered evidence.
---

# verid-release (Antigravity)

Run only after `verid serve <module>` closed the module. Write records only: never push, open a
pull request, tag, publish or deploy; the developer merges.

## Steps

1. Fill `.verid/artifacts/03-modules/<module>/release/release-plan.md` (create it from
   `.verid/templates/module/release/release-plan.md` when missing) with:
   - rollout steps and prerequisites;
   - migrations and compatibility, or one line saying there are none;
   - validation and monitoring after rollout;
   - rollback steps and what a rollback loses;
   - evidence, cited not copied: last passing `verid taste` run from `verid menu`, the
     module's `review/review.md`, commits from `verid menu --commits`;
   - owner, as the developer names them.
2. Add one line to `.verid/artifacts/07-release/README.md`: module, date, commit range, record path.
3. Ask with `ask_question` for what the repo cannot answer; write `[NEEDS CLARIFICATION: <question>]` where the developer defers.
