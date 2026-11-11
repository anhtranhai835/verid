---
name: release
description: Use after verid serve closes a module, to fill its release record with rollout, rollback, migrations and delivered evidence.
---

# verid: release record

Run after `verid serve <module>` closed the module (in no-brain drive, after verid served it).
A record before serve claims evidence that does not exist yet. This skill writes records only:
never push, open a pull request, tag, publish or deploy. Handoff of the product stays with
verid:review; the developer merges.

Fill `.verid/artifacts/03-modules/<module>/release/release-plan.md`; create it from
`.verid/templates/module/release/release-plan.md` when a quick or fix dossier has none.

1. Rollout: prerequisites, order of steps, feature flags or configuration it needs.
2. Migrations and compatibility: data or schema changes, who runs them, what older clients see.
   None? Say so in one line.
3. Validation and monitoring: what shows it works after rollout, and who watches it.
4. Rollback: the exact steps back, and what a rollback loses. A migration without a way back
   says so and names who decided to accept that.
5. Evidence: cite, do not copy. The served module's last passing `verid taste` run as
   `verid menu` reports it, the review record in the module's `review/review.md`, and the
   commits from `verid menu --commits` (sha and subject). Nothing you did not see.
6. Owner: the person who rolls it out, from the developer, not a guess.

Add one line per module to `.verid/artifacts/07-release/README.md`: module, date, the
commit range and the path of its release record.

Ask the developer for what the repository cannot answer (environments, owners, schedules)
one question at a time, and write `[NEEDS CLARIFICATION: <question>]` where they defer.
Then report the record's path and any open question.
