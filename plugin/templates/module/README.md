# Module: {{module}}

Status: draft
Owner: [NEEDS CLARIFICATION: responsible owner]
Sources: [NEEDS CLARIFICATION: .verid/docs/ files and section references]
Dependencies: [NEEDS CLARIFICATION: module names and public interfaces]

| Phase    | Document                     | Outcome                                                   |
| -------- | ---------------------------- | --------------------------------------------------------- |
| BA       | ba/requirements.md           | scope, users, EARS requirements and sources               |
| UI       | ui/brief.md                  | screens, states and accessibility, or reason inapplicable |
| Spec     | spec/spec.md; spec/design.md | contracts, data, errors and dependency boundaries         |
| Tests    | tests/test-plan.md           | requirement → AC → test mapping                           |
| Security | security/threat-model.md     | assets, threats, abuse cases and mitigations              |
| Review   | review/review.md             | real independent findings and evidence pointers           |
| Release  | release/release-plan.md      | rollout, rollback, migrations and delivery evidence       |

Keep REQ/NFR/SEC/AC IDs unique across the project. Publish agreed requirements in
.verid/spec.md and ACs in .verid/plan.md. Use .verid/templates/plan-section.md.
