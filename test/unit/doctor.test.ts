import { describe, expect, it } from "vitest";
import { node22OrLater, sandboxBlocked } from "../../src/core/doctor.js";

describe("doctor facts", () => {
  it("requires a valid Node version of at least 22", () => {
    const rows = [
      { version: "v21.9.0", want: false },
      { version: "v22.0.0", want: true },
      { version: "24.1.2", want: true },
      { version: "unknown", want: false },
      { version: "v22.nope", want: false },
    ];
    for (const { version, want } of rows) expect(node22OrLater(version)).toBe(want);
  });

  // Inside Codex's sandbox a probe cannot start a process; that is not a broken install.
  it("tells a blocked subprocess from a failed one", () => {
    const coded = (code: string) => Object.assign(new Error(`spawnSync git ${code}`), { code });
    const rows = [
      { error: coded("EPERM"), want: true },
      { error: coded("EACCES"), want: true },
      { error: new Error("spawnSync git EPERM"), want: true },
      { error: coded("ENOENT"), want: false },
      { error: new Error("fatal: not a git repository"), want: false },
      { error: undefined, want: false },
    ];
    for (const { error, want } of rows) expect(sandboxBlocked(error), String(error)).toBe(want);
  });
});
