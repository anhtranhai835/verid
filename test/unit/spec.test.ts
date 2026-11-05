import { describe, expect, it } from "vitest";
import { specTrace } from "../../src/core/spec.js";

const SPEC = `# Spec

## Requirements

- REQ-1: When a visitor signs up, the system shall create an account. (source: docs/brd.md)
- REQ-2: If the email exists, then the system shall refuse it. (source: Q3)
  Changed 2026-11-01: wording, because of review
- REQ-3: The system shall export CSV.
  Dropped 2026-11-02: out of scope now

## Non-functional

- NFR-1: The system shall answer within 500 ms.

## Security

- SEC-1: The system shall hash passwords.

## Abuse cases

- A-1: many passwords for one email → SEC-1.
`;

describe("specTrace: requirements and the ACs that cite them", () => {
  it("lists live spec IDs no AC or Review Focus line cites, and cited IDs the spec lacks", () => {
    const rows = [
      {
        name: "every live ID cited",
        plan: "## Module: a\n- AC-1: signs up (REQ-1, REQ-2)\n- AC-2: fast (NFR-1, SEC-1)\n",
        want: { uncovered: [], unknown: [] },
      },
      {
        name: "nothing cited",
        plan: "## Module: a\n- AC-1: signs up\n",
        want: { uncovered: ["REQ-1", "REQ-2", "NFR-1", "SEC-1"], unknown: [] },
      },
      {
        name: "a Review Focus line covers with a reason",
        plan: "## Module: a\nReview Focus: NFR-1 is measured in staging.\n- AC-1: x (REQ-1, REQ-2, SEC-1)\n",
        want: { uncovered: [], unknown: [] },
      },
      {
        name: "cited but unknown or dropped",
        plan: "## Module: a\n- AC-1 (e2e): x (REQ-1, REQ-2, NFR-1, SEC-1, REQ-3, REQ-9)\n",
        want: { uncovered: [], unknown: ["REQ-3", "REQ-9"] },
      },
      {
        name: "plain prose mentioning an ID is no citation",
        plan: "## Module: a\nThis module relates to REQ-1.\n- AC-1: x (REQ-2, NFR-1, SEC-1)\n",
        want: { uncovered: ["REQ-1"], unknown: [] },
      },
      {
        name: "REQ-1 is not found inside REQ-10 or XREQ-1",
        plan: "## Module: a\n- AC-1: x (REQ-10, XREQ-1, REQ-2, NFR-1, SEC-1)\n",
        want: { uncovered: ["REQ-1"], unknown: ["REQ-10"] },
      },
      {
        name: "CRLF line endings",
        plan: "## Module: a\r\n- AC-1: x (REQ-1, REQ-2, NFR-1, SEC-1)\r\n",
        want: { uncovered: [], unknown: [] },
      },
    ];
    for (const { name, plan, want } of rows) expect(specTrace(SPEC, plan), name).toEqual(want);
    expect(specTrace(SPEC.replaceAll("\n", "\r\n"), rows[0]!.plan), "CRLF spec").toEqual({
      uncovered: [],
      unknown: [],
    });
  });
});
