# Modular cook workflow

Based on the supplied 10-repo-structure.md, adapted to verid's providers and TDD gates.
The project workspace is .verid/; runtime evidence stays in .verid/.state/.

1. Baseline: inventory repos, existing code, runners and risks in artifacts/00-baseline/. For an existing project, record adoption scope before proposing changes.
2. Research: read .verid/docs/; write research evidence in artifacts/01-research/ and the agreed summary in .verid/research.md.
3. Discovery: map users, scope, dependencies and delivery modules in artifacts/02-discovery/.
4. Module dossiers: run `verid module <kebab-name>` for every module. Fill ba/, ui/, spec/, tests/ and security/ using .verid/templates/module/. Every statement needs a source or an explicit clarification. For inapplicable UI/security items record the reason.
5. Specification: publish all agreed REQ-n, NFR-n and SEC-n lines with globally unique IDs in .verid/spec.md. Link each to the module dossier. Include contracts, data, errors and observable boundaries.
6. Design: record agreed architecture in .verid/design.md, reusable code, interfaces, dependency directions and module map. Store decisions in artifacts/adr/. Update architecture-profile.md and constitution.md with agreed project conventions.
7. Plan: draft tasks in artifacts/04-plans/ and executable ACs in .verid/plan.md. Each module has `## Module: <name>`, optional Iteration first, Depends, `Artifacts: .verid/artifacts/03-modules/<name>`, then AC-n lines citing spec IDs. Use .verid/templates/plan-section.md. Do not copy template AC IDs across modules.
8. Order: resolve all [NEEDS CLARIFICATION: ...] in input dossiers and the plan. In human drive the developer runs `verid order <name>`; in auto drive the developer signs research/spec/design with `verid order`, then agents follow the normal auto cycle. Module approval includes ba/ui/spec/tests/security inputs; changes require re-ordering.
9. Build and test: use mapped writers and `verid taste` through RAW → COOKING → PLATED. Codex main writes both tests and code. Store implementation notes in artifacts/05-implementation/ and test evidence pointers in the module's tests/. Keep runtime evidence in .state/.
10. Evaluate: prepare `verid menu --commits --file`. Give a fresh read-only reviewer that packet, ACs, module dossier, design and diff. Main records its actual findings in the module's review/ and artifacts/06-evaluation/. Reviewers write nothing.
11. Release: the normal serve gate checks evidence and the review; main records release notes in the module's release/ and artifacts/07-release/. The developer serves in human drive. Continue to the next module.

Templates are drafts. Do not claim an approval, HMAC signature, scan, test run or review merely because a folder/file exists.
The approvals/ folder is reserved for human-readable decision records; verid's actual approvals are in .state/, not signed exports.

## Resources

When resources: repo, .verid/agents, skills, templates and policies are project-owned copies.
Claude uses local verid-<name> entries under .claude/. Codex uses .agents/skills/ entries
and a project reviewer in .codex/config.toml. Native entries read the repo copies.
Cook fills missing files and preserves existing copies; upgrades do not overwrite customization.
After cloning, install the verid CLI and run cook to regenerate this machine's hooks, then
trust the project and hooks in Codex. Commit the resource copies, templates and dossiers.
