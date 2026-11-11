# Modular cook workflow

Based on the supplied 10-repo-structure.md, adapted to verid's providers and TDD gates.
The project workspace is .verid/; runtime evidence stays in .verid/.state/.
With resources: repo, run the verid commands below as `node .verid/verid.mjs <command>`
from the project root. The local CLI and its runtime dependencies are bundled.
For each request or new symptom, use `.verid/templates/skill-routing.md` to select
the matching skills and agents. Load only the relevant branch, then resume this flow.

1. Baseline: inventory repos, existing code, runners and risks in artifacts/00-baseline/. For an existing project, record adoption scope before proposing changes.
2. Research: inventory .verid/docs/ read-only. For DOCX/PDF or large inputs follow verid:context-engineering's document-reading guide: outline, search, then read exact source sections. Account for all sections/pages as read and mapped to requirements, irrelevant with a reason, or unresolved; record source versions and coverage in .verid/research.md, with longer evidence in artifacts/01-research/. Resolve missing evidence affecting scope before approval.
3. Discovery: map users, scope, dependencies and delivery modules in artifacts/02-discovery/.
4. Module dossiers: run `verid module <kebab-name>` for every module. Fill ba/, ui/, spec/, tests/ and security/ using .verid/templates/module/. Every statement needs a source or an explicit clarification. `verid module` prefills requirements and the AC table when the plan has the module. Write detail once, in the dossier; a document that does not apply is one line, `Not applicable: <reason>`.
5. Specification: publish all agreed REQ-n, NFR-n and SEC-n lines with globally unique IDs in .verid/spec.md. Each is its ID and one line; the dossier holds the detail (contracts, data, errors, observable boundaries).
6. Design: record agreed architecture in .verid/design.md: only the interfaces between modules, dependency directions and module map; module internals stay in the dossier. Store decisions in artifacts/adr/. Update architecture-profile.md and constitution.md with agreed project conventions.
7. Plan: draft tasks in artifacts/04-plans/ and executable ACs in .verid/plan.md. Each module has `## Module: <name>`, optional Iteration first, Depends, `Artifacts: .verid/artifacts/03-modules/<name>`, then AC-n lines citing spec IDs. Use .verid/templates/plan-section.md. Do not copy template AC IDs across modules.
8. Order: resolve all [NEEDS CLARIFICATION: ...] in input dossiers and the plan. In big-brain drive the developer runs `verid order <name>`; in no-brain drive the developer signs research/spec/design with `verid order`, then agents follow the normal auto cycle. Module approval includes ba/ui/spec/tests/security inputs; changes require re-ordering.
9. Build and test: use mapped writers and `verid taste` through RAW → COOKING → PLATED. Codex main writes both tests and code. Store implementation notes in artifacts/05-implementation/ and test evidence pointers in the module's tests/. Keep runtime evidence in .state/.
10. Evaluate: prepare `verid menu --commits --file`. Give a fresh read-only reviewer that packet, ACs, module dossier, design and diff. Main records its actual findings in the module's review/ and artifacts/06-evaluation/. Reviewers write nothing.
11. Release: the normal serve gate checks evidence and the review; main records release notes in the module's release/ and artifacts/07-release/. The developer serves in big-brain drive. Continue to the next module.

Templates are drafts. Do not claim an approval, HMAC signature, scan, test run or review merely because a folder/file exists.
The approvals/ folder is reserved for human-readable decision records; verid's actual approvals are in .state/, not signed exports.

## Context between stages

Load applicable instructions once per context and reload changed or missing parts.
Pass module/AC IDs, paths, exact sections, source versions and evidence gaps between
stages; read cited sources and expand through relevant contracts and exceptions.
Use verid:context-engineering's flow-context guide for large handoffs. Initial BA and
product review still cover their full scope. Keep reviewer contexts fresh, all gates
and role boundaries, and the complete review evidence. Use peek within the TDD loop.
Reports and handoffs give status, paths, findings and the next step only; do not retell files read or repeat ACs.

## Resources

When resources: repo, .verid/agents, skills, templates and policies are project-owned copies.
Claude uses local verid-<name> entries under .claude/. Codex uses .agents/skills/ entries
and a project reviewer in .codex/config.toml. Native entries read the repo copies.
Cook fills missing files and preserves existing copies; upgrades do not overwrite customization.
After cloning, run `node .verid/verid.mjs cook --yes` to regenerate this machine's hooks, then
trust the project and hooks in Codex. Commit the resource copies, templates and dossiers.

For prep/recipe, the developer arranges the priority queue in `verid board`. Complete module dossiers before order. Big-brain drive binds one fresh session per selected task and stops after serve. No-brain drive follows that queue in one session after `verid order`; reprioritizing never interrupts current work. Remix keeps its baseline flow.
