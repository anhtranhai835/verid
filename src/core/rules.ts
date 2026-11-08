export const ARCHITECTURES = ["ddd", "clean", "layered", "none"] as const;
export type Architecture = (typeof ARCHITECTURES)[number];

/** Cook's note in `.verid/docs/`, the folder for the developer's own requirement documents. */
export const DOCS_NOTE =
  "# Project documents\n\nPut your requirements, BRD/PRD, specifications and designs here. verid:ba inventories them before asking questions and cites their sections/pages in .verid/research.md and .verid/spec.md. Agents only read this folder; only the developer adds or edits files. For DOCX, text PDF and Markdown/TXT, verid:context-engineering provides a local outline/search/section reader. PDF needs an available pypdf installation; scans need OCR or visual inspection. Export other formats outside this folder with source provenance. Track every section as read, irrelevant with a reason, or unresolved; summaries never replace missing source evidence.\n";

/** Project-owned guidance. Hooks protect TDD and their own integrity; these rules are audited. */
export function projectRules(architecture: Architecture): Record<string, string> {
  const architectures: Record<Architecture, string> = {
    ddd: "Use bounded contexts and their shared language. Keep domain rules independent of infrastructure. Describe contexts, layers, public seams and dependency direction in .verid/design.md. Apply SOLID where it makes the design simpler; do not require an interface for every class.",
    clean:
      "Keep entities and use cases independent of frameworks. Adapters depend on application boundaries; frameworks sit outside them. Describe layers, public seams and dependency direction in .verid/design.md. Apply SOLID where useful without adding unnecessary abstractions.",
    layered:
      "Describe presentation, application, domain and infrastructure layers in .verid/design.md. Record allowed dependency directions and public seams. Keep business rules testable without the delivery mechanism.",
    none: "Follow the project's existing structure. Record only the boundaries and public seams the developer agrees to in .verid/design.md. Do not impose a named architecture.",
  };
  return {
    "git.md":
      "# Git conventions\n\nUse Conventional Commits. Make small, feature-scoped commits: one coherent, independently reviewable change per commit. Split a large feature into useful increments, such as prerequisite setup, one behaviour with its tests, a focused fix, or supporting documentation. Keep each commit buildable and its relevant verification passing; do not commit a broken intermediate TDD state. Never mix unrelated features, bulk formatting or broad refactors into a feature commit. Stage only intended files or hunks and inspect git diff --staged before committing. A task may have several small commits; do not optimize for the fewest commits or impose arbitrary file or line limits.\n\nExamples:\n- feat(kanban): add task selection\n- feat(sessions): enforce task ownership\n- style(kanban): add kitchen theme\n- docs(workflow): document session handoff\n\nUse a new feat/, fix/, chore/, docs/, refactor/ or test/ branch for each piece of work; start fixes from main. Open one PR per branch, squash-merge and delete merged branches. Do not push directly to protected branches. Git conventions are guidance: audit warns without blocking TDD or module completion. Multiple valid commits are not a warning.\n",
    "architecture.md": `# Architecture: ${architecture}\n\n${architectures[architecture]}\n\nReview changes against these project rules. A configured architecture checker runs with verid taste and reports warnings; it does not block serving a module.\n`,
    "workflow.md":
      "# Workflow conventions\n\nSettle research (reading the developer's documents in .verid/docs/ first), then the spec in .verid/spec.md, then design, then a plan whose testable acceptance criteria cite the spec's IDs. Drafting agents should stay with their assigned documents; QA should focus on end-to-end tests. Read .verid/rules/git.md and architecture.md when relevant. These conventions are audited without blocking. Developer approval of modules, TDD evidence, tester/coder separation, read-only reviews and auto safety limits remain enforced.\n",
  };
}
