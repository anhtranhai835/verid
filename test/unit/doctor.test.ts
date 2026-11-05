import { describe, expect, it } from "vitest";
import { node22OrLater } from "../../src/core/doctor.js";

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
});
