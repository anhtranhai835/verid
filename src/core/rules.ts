export const ARCHITECTURES = ["ddd", "clean", "layered", "none"] as const;
export type Architecture = (typeof ARCHITECTURES)[number];

/** Cook's note in `.verid/docs/`, the folder for the developer's own requirement documents. */
export const DOCS_NOTE =
  "# Project documents\n\nPut the documents you already have here: requirements, BRD/PRD, specifications, designs, exported PDFs. verid:ba reads them before asking questions and cites them in .verid/research.md and .verid/spec.md. Agents may only read this folder; only the developer adds or edits files in it. Prefer Markdown or PDF; export other formats.\n";

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
      "# Git conventions\n\nUse Conventional Commits, each containing one complete change. Use a new feat/, fix/, chore/, docs/, refactor/ or test/ branch for each piece of work; start fixes from main. Keep commits few, open one PR per branch, squash-merge and delete merged branches. Do not push directly to protected branches. Git conventions are guidance: audit warns without blocking TDD or module completion.\n",
    "architecture.md": `# Architecture: ${architecture}\n\n${architectures[architecture]}\n\nReview changes against these project rules. A configured architecture checker runs with verid taste and reports warnings; it does not block serving a module.\n`,
    "workflow.md":
      "# Workflow conventions\n\nSettle research (reading the developer's documents in .verid/docs/ first), then the spec in .verid/spec.md, then design, then a plan whose testable acceptance criteria cite the spec's IDs. Drafting agents should stay with their assigned documents; QA should focus on end-to-end tests. Read .verid/rules/git.md and architecture.md when relevant. These conventions are audited without blocking. Developer approval of modules, TDD evidence, tester/coder separation, read-only reviews and auto safety limits remain enforced.\n",
  };
}
