import { describe, expect, it } from "vitest";
import { decideRole, splitOn, subagentHold, writerOf, type Writer } from "../../src/core/roles.js";
import { isOverridable } from "../../src/core/errors.js";

describe("roles", () => {
  it("names the writer from the payload, a role only with an agent_id", () => {
    const roles = { reviewer: ["feature-dev:code-reviewer"], coder: ["general-purpose"] };
    const rows: [string, string | undefined, string | undefined, Writer][] = [
      ["main thread", undefined, undefined, "main"],
      ["claude --agent", undefined, "feature-dev:code-reviewer", "main"],
      ["mapped reviewer", "a1", "feature-dev:code-reviewer", "reviewer"],
      ["mapped coder", "a1", "general-purpose", "coder"],
      ["unmapped subagent", "a1", "Explore", "other"],
      ["subagent with no type", "a1", undefined, "other"],
    ];
    expect(Object.fromEntries(rows.map(([n, id, type]) => [n, writerOf(id, type, roles)]))).toEqual(
      Object.fromEntries(rows.map(([n, , , want]) => [n, want])),
    );
    expect(writerOf("a1", "general-purpose", undefined)).toBe("other");
  });

  it("splits tests from code only when both a tester and a coder are mapped", () => {
    const rows: [string, Parameters<typeof splitOn>[0], boolean][] = [
      ["no roles", undefined, false],
      ["a reviewer only", { reviewer: ["r"] }, false],
      ["tester and coder", { tester: ["t"], coder: ["c"] }, true],
    ];
    expect(Object.fromEntries(rows.map(([n, roles]) => [n, splitOn(roles)]))).toEqual(
      Object.fromEntries(rows.map(([n, , want]) => [n, want])),
    );
  });

  it("recognises each new role only for its mapped subagent", () => {
    const roles = {
      researcher: ["custom:research"],
      architect: ["custom:architecture"],
      planner: ["custom:plan"],
      qa: ["custom:qa"],
    };
    const rows = [
      ["a", "custom:research", "researcher"],
      ["a", "custom:architecture", "architect"],
      ["a", "custom:plan", "planner"],
      ["a", "custom:qa", "qa"],
      [undefined, "custom:research", "main"],
      ["a", "verid:qa", "other"],
    ] as const;
    for (const [id, type, want] of rows) expect(writerOf(id, type, roles)).toBe(want);
  });

  it("keeps each drafting role to its own project document regardless of the split", () => {
    const rows = [
      ["researcher", false, ".verid/research.md", "allow"],
      ["architect", true, ".verid/design.md", "allow"],
      ["planner", true, ".verid/plan.md", "allow"],
      ["researcher", false, ".verid/design.md", "VERID_BURNT_ROLE_DOC_ONLY"],
      ["architect", true, ".verid/plan.md", "VERID_BURNT_ROLE_DOC_ONLY"],
      ["planner", false, "README.md", "VERID_BURNT_ROLE_DOC_ONLY"],
      ["researcher", true, "test/a.test.ts", "VERID_BURNT_ROLE_DOC_ONLY"],
      ["architect", false, "src/a.ts", "VERID_BURNT_ROLE_DOC_ONLY"],
      ["planner", true, null, "VERID_BURNT_ROLE_DOC_ONLY"],
    ] as const;
    for (const [writer, split, path, want] of rows) {
      const d = decideRole(writer, split, path === null ? "outside" : "free", "display", path);
      expect(d.kind === "deny" ? d.code : d.kind, `${writer} ${path}`).toBe(want);
    }
  });

  it("allows qa only end-to-end tests and keeps them available to the split tester", () => {
    const rows = [
      ["qa", false, "e2e", "allow"],
      ["qa", true, "e2e", "allow"],
      ["tester", true, "e2e", "allow"],
      ["coder", true, "e2e", "VERID_BURNT_ROLE_TESTER_ONLY"],
      ["main", true, "e2e", "VERID_BURNT_ROLE_TESTER_ONLY"],
      ["qa", false, "test", "VERID_BURNT_ROLE_QA_E2E_ONLY"],
      ["qa", true, "code", "VERID_BURNT_ROLE_QA_E2E_ONLY"],
      ["qa", false, "free", "VERID_BURNT_ROLE_QA_E2E_ONLY"],
      ["qa", true, "outside", "VERID_BURNT_ROLE_QA_E2E_ONLY"],
    ] as const;
    for (const [writer, split, file, want] of rows) {
      const d = decideRole(writer, split, file, "display");
      expect(d.kind === "deny" ? d.code : d.kind, `${writer} ${file}`).toBe(want);
    }
  });

  it("lets the developer override the new role restrictions", () => {
    const rows = ["VERID_BURNT_ROLE_DOC_ONLY", "VERID_BURNT_ROLE_QA_E2E_ONLY"] as const;
    for (const code of rows) expect(isOverridable(code), code).toBe(true);
  });

  it("lets each writer write only what its role allows", () => {
    const rows: [Writer, boolean, "test" | "code" | "free" | "outside", string][] = [
      ["reviewer", false, "free", "VERID_BURNT_ROLE_READ_ONLY"],
      ["reviewer", false, "outside", "VERID_BURNT_ROLE_READ_ONLY"],
      ["coder", true, "test", "VERID_BURNT_ROLE_TESTER_ONLY"],
      ["coder", true, "code", "allow"],
      ["tester", true, "code", "VERID_BURNT_ROLE_CODER_ONLY"],
      ["tester", true, "test", "allow"],
      ["main", true, "code", "VERID_BURNT_ROLE_CODER_ONLY"],
      ["main", true, "test", "VERID_BURNT_ROLE_TESTER_ONLY"],
      ["main", true, "free", "allow"],
      ["other", true, "code", "VERID_BURNT_ROLE_CODER_ONLY"],
      ["main", false, "code", "allow"],
      ["coder", false, "test", "allow"],
    ];
    const verdict = (w: Writer, split: boolean, file: (typeof rows)[number][2]) => {
      const d = decideRole(w, split, file, "x");
      return d.kind === "allow" ? "allow" : d.code;
    };
    const name = ([w, split, file]: (typeof rows)[number]) =>
      `${w} ${split ? "split" : "joint"} ${file}`;
    expect(Object.fromEntries(rows.map((r) => [name(r), verdict(r[0], r[1], r[2])]))).toEqual(
      Object.fromEntries(rows.map((r) => [name(r), r[3]])),
    );
  });

  it("holds a writing subagent the way Stop holds the main thread, the tester excepted while tests fail", () => {
    const rows: [Writer, boolean, "RAW" | "COOKING" | "PLATED", boolean, boolean, string | null][] =
      [
        ["coder", true, "COOKING", false, false, "stop.green"],
        ["tester", true, "COOKING", false, false, null],
        ["tester", true, "RAW", false, true, "stop.unverified"],
        ["other", false, "PLATED", false, true, "stop.unverified"],
        ["other", false, "PLATED", false, false, null],
        ["coder", true, "RAW", true, false, "stop.stub"],
        ["tester", true, "RAW", true, false, null],
        ["reviewer", false, "COOKING", false, true, null],
        ["qa", true, "COOKING", false, true, "stop.unverified"],
        ["qa", false, "RAW", true, false, null],
        ["qa", true, "COOKING", false, false, null],
      ];
    const name = (r: (typeof rows)[number]) => r.slice(0, 5).join(" ");
    expect(
      Object.fromEntries(
        rows.map((r) => [
          name(r),
          subagentHold(r[0], r[1], { state: r[2], stub: r[3], dirty: r[4] }),
        ]),
      ),
    ).toEqual(Object.fromEntries(rows.map((r) => [name(r), r[5]])));
  });
});
