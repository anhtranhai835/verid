# Request and workflow routing

Search trigger lines/headings for the current request or symptom; read the matching
branch and keep it in context. Open the full index only when routing is unclear.
Load the chosen skill and relevant references, then resume the active workflow once
its question is answered. Never run this entire catalog as a ritual.

Names below mean `verid:<name>` when installed, `verid-<name>` with repo resources.
Use manifest mappings for role agents. On Codex, main performs writer/helper work
using these skills; spawn only configured agents such as `verid_reviewer` for
independent review. Respect host delegation permissions. Read-only helpers advise;
they neither approve work nor replace a required reviewer.

## Intake and decisions

- New workspace, setup or orientation → [onboard](../skills/onboard/SKILL.md), main:
  report health/status and next step, without writes.
- New idea, unclear scope or changed requirement → [ba](../skills/ba/SKILL.md), main:
  cited research and agreed REQ/NFR/SEC scope; developer decisions stay here.
- DOCX/PDF, large inputs, repeated reads or context loss →
  [context-engineering](../skills/context-engineering/SKILL.md), then resume BA or
  the active step: source coverage, exact excerpts and unresolved extraction gaps.
- Competing approaches → [design](../skills/design/SKILL.md), with
  [brainstormer](../agents/brainstormer.md) for a focused comparison and mapped
  [architect](../agents/architect.md) for architecture/reuse inventory.
  Use [predict](../skills/predict/SKILL.md) before major/risky design decisions;
  its result is advice. End with an agreed design.
- Missing/current library API facts → [docs-seeker](../skills/docs-seeker/SKILL.md);
  [technical-researcher](../agents/technical-researcher.md) handles a scoped technical
  question: versioned primary sources and a supported answer.
- Agreed design needs delivery slices → [plan](../skills/plan/SKILL.md), mapped
  [planner](../agents/planner.md): every requirement/component has an AC or explicit
  Review Focus.
- Prep or recipe module planning → [modules](../skills/modules/SKILL.md)
  alongside BA → design → plan: sourced dossiers before developer order.

## Implementation

For an ordered module, [build](../skills/build/SKILL.md) coordinates
[tdd](../skills/tdd/SKILL.md): mapped [tester](../agents/tester.md) or
[qa](../agents/qa.md) writes the failing test, then [coder](../agents/coder.md)
implements. One writer at a time; Codex main writes both. Select domain branches
only when the AC touches them; guidance never expands scope or authorizes deployment.

- API, authentication or service behaviour → [backend-development](../skills/backend-development/SKILL.md).
- Web component or TypeScript UI → [frontend-development](../skills/frontend-development/SKILL.md).
- React/Next.js performance concern → [react-best-practices](../skills/react-best-practices/SKILL.md): measure and open matching rules.
- Layout, interaction or accessibility → [ui-ux-pro-max](../skills/ui-ux-pro-max/SKILL.md);
  [ui-ux-designer](../agents/ui-ux-designer.md) critiques the chosen screen and states.
- iOS, Android, React Native or Flutter → [mobile-development](../skills/mobile-development/SKILL.md).
- Schema, query, index or migration → [databases](../skills/databases/SKILL.md).
- CI, containers, cloud or deployment configuration → [devops](../skills/devops/SKILL.md).
- MCP server or tool integration → [mcp-builder](../skills/mcp-builder/SKILL.md).
- Browser, accessibility, API integration or load-test design → [web-testing](../skills/web-testing/SKILL.md)
  via tester/QA; only verid taste records gate evidence.
- Input/state/permission/timing boundaries → [edge-cases](../skills/edge-cases/SKILL.md)
  before tester/QA writes tests; out-of-AC risks return to BA/plan.

## Failures and follow-up

- User reports a bug, test fails or behaviour is unexpected → [debugging](../skills/debugging/SKILL.md)
  before proposing a fix. Use [debugger](../agents/debugger.md) for a distinct read-only
  investigation. Reproduced cause → build/TDD, or BA/plan if scope changes.
- Repeatedly failed approaches, growing complexity or conflicting assumptions →
  [problem-solving](../skills/problem-solving/SKILL.md), after debugging for bugs:
  one relevant technique, an evidence-backed option or explicit missing decision.
  Main handles it; brainstormer is useful only for another concrete comparison.
- Passing cycle with duplication/needless complexity → [code-simplifier](../agents/code-simplifier.md)
  suggests; coder/main makes a small behaviour-preserving refactor in PLATED and runs taste.
- All module ACs pass, or plan/product needs independent review → [review](../skills/review/SKILL.md),
  fresh mapped [reviewer](../agents/reviewer.md), configured verid_reviewer on Codex:
  full AC coverage and current verdict. Fixes require a fresh packet/review.
- Module served → [release](../skills/release/SKILL.md), main: its release record with
  rollout, rollback, migrations and cited evidence. It never pushes, opens a PR or deploys.
- Correctness passes and security is mapped, or combined review needs security →
  [security skill](../skills/security/SKILL.md), [security agent](../agents/security.md)
  or Codex reviewer's combined contract: complete security coverage and final verdict.
- Authorized secret/dependency/risky-path scan, or missing security scan evidence →
  main uses [security-scan](../skills/security-scan/SKILL.md), saves redacted evidence
  for security. The reviewer reads results and runs nothing; scans do not replace review.
- User requests progress/blockers → [project-manager](../agents/project-manager.md)
  reads main's current menu/evidence: factual status, owner and next action, without state edits.
- Changed behaviour needs docs, or user requests a docs audit → [docs-manager](../agents/docs-manager.md)
  checks changed docs/code/decisions; main applies cited corrections. Originals stay read-only.

Handoffs carry module/AC IDs, paths and exact sections, allowed writes, evidence
locations and missing questions. Expand into relevant dependencies and exceptions.
Keep source-version checks, full initial BA coverage, all gates and complete fresh
independent reviews. Reload shared rules only when changed or missing. A short
summary never justifies dropping a requirement, finding or missing evidence.
