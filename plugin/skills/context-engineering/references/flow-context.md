# Context across the flow

Project instructions already present in the current context need no repeated read.
Fresh agents still load their applicable rules. After compaction or source changes,
reload the missing or changed parts; an old summary is not an approval or test result.

| Stage | Minimum useful input | Expand when |
| --- | --- | --- |
| BA | Document inventory, source coverage, request and relevant existing behaviour | A section is unread, extraction is incomplete, or scope conflicts |
| Design | Agreed research/spec IDs, affected contracts and source citations | Checking reuse, cross-repo effects and dependency directions; inventory every manifest repo |
| Plan | Full requirement ID inventory, design component/interface map and module dependencies | Proving every requirement and required component has an AC or explicit Review Focus |
| Build | Open module, AC, named design rows, relevant tests/callers and latest log entry | Interfaces, invariants, failure paths or source requirements are unclear |
| Review | Fresh complete review packet, every module AC, changed files and relevant contracts | Following callers, shared effects and security boundaries; product review spans every module |

Give a writer the module/AC IDs, exact file paths and section names or line ranges,
allowed write scope, relevant interfaces, and current evidence/missing questions.
Share a source hash for derived document excerpts. Read source directly instead of
pasting its full text into dispatch. Return changed paths, result, evidence location
and unresolved issues; avoid repeating the task, source or complete tool logs.

Dispatch helpers only for a concrete question or required role. Main can handle a
small task directly where the provider permits it. Keep tester/coder responsibilities,
sequential shared-cycle writes and fresh independent review. Reusing a long writer
history is not automatically cheaper. Do not add an agent per document or per section.

Use `verid peek` inside the TDD loop; use `verid menu` when module-wide status is needed.
`verid menu --commits --file` returns the review packet's path. The reviewer must still
read all relevant evidence: truncation or missing history needs follow-up, never a pass
based on a short summary. Regenerate the packet after changes.

Use the module log to resume decisions and next actions, not to copy source or logs.
Long reports may be saved by main in the appropriate artifact and handed off by path;
read-only helpers do not write them. Do not read private `.verid/.state/` directly.

Measure complete tasks: input/output tokens and cached input when the provider exposes
them, plus tool-output characters, repeated reads, retries and AC/review outcomes.
Do not report character reduction as billed-token savings or expect identical wording
from a changed AI context. Preserve required findings and evidence in compact reports.
