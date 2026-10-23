import { describe, expect, it } from "vitest";
import { decideRole, splitOn, subagentHold, writerOf, type Writer } from "../../src/core/roles.js";

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
