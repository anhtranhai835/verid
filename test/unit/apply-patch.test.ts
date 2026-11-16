import { describe, expect, it } from "vitest";
import { parseApplyPatch } from "../../src/core/apply-patch.js";

describe("apply_patch targets", () => {
  it("extracts every write in valid patches without interpreting content as headers", () => {
    const rows = [
      {
        patch: "*** Begin Patch\n*** Add File: src/new.ts\n+x\n*** End Patch",
        targets: ["src/new.ts"],
      },
      {
        patch:
          "*** Begin Patch\r\n*** Update File: src/a.ts\r\n@@\r\n-old\r\n+new\r\n*** End Patch\r\n",
        targets: ["src/a.ts"],
      },
      {
        patch: "*** Begin Patch\n*** Delete File: test/old.test.ts\n*** End Patch",
        targets: ["test/old.test.ts"],
      },
      {
        patch:
          "*** Begin Patch\n*** Update File: test/a.test.ts\n*** Move to: src/a.ts\n@@\n-old\n+new\n*** End Patch",
        targets: ["test/a.test.ts", "src/a.ts"],
      },
      {
        patch:
          "*** Begin Patch\n*** Add File: path with spaces/a.txt\n+*** Delete File: safe.txt\n+*** End Patch\n*** Update File: b.txt\n-old\n+*** Move to: ignored.txt\n*** End of File\n*** Delete File: c.txt\n*** End Patch",
        targets: ["path with spaces/a.txt", "b.txt", "c.txt"],
      },
      { patch: "*** Begin Patch\n*** Add File: empty.txt\n*** End Patch", targets: ["empty.txt"] },
      {
        patch:
          "*** Begin Patch\n*** Update File: a.txt\n@@ first\n a\n-b\n+c\n@@ next\n d\n-e\n+f\n*** End Patch",
        targets: ["a.txt"],
      },
    ];
    for (const row of rows)
      expect(parseApplyPatch(row.patch), row.patch).toEqual({ targets: row.targets });
  });

  it("rejects malformed or routed syntax before accepting any targets", () => {
    const rows = [
      "",
      "*** Begin Patch\n*** End Patch",
      "prefix\n*** Begin Patch\n*** Delete File: a\n*** End Patch",
      "*** Begin Patch\n*** Add File: a\n+ok",
      "*** Begin Patch\n*** Add File: a\nraw\n*** End Patch",
      "*** Begin Patch\n*** Update File: a\n*** Move to: b\n*** End Patch",
      "*** Begin Patch\n*** Update File: a\n@@\n*** End Patch",
      "*** Begin Patch\n*** Update File: a\n@@\n+x\n*** Move to: b\n*** End Patch",
      "*** Begin Patch\n*** Delete File: a\n+x\n*** End Patch",
      "*** Begin Patch\n*** Add File: \n+x\n*** End Patch",
      "*** Begin Patch\n*** Add File: a\n+x\n*** End Patch\ntrailing",
      "*** Begin Patch\nEnvironment ID: other\n*** Delete File: a\n*** End Patch",
      "*** Begin Patch\n*** Environment ID: other\n*** Delete File: a\n*** End Patch",
      "*** Begin Patch\n*** Rename File: a\n*** End Patch",
      "*** Begin Patch\n*** Update File: a\n+x\n*** End of File\n+y\n*** End Patch",
      "*** Begin Patch\n*** Add File: a\u0000b\n+x\n*** End Patch",
      // Codex trims Unicode whitespace verid's own trim keeps, and would write another path.
      "*** Begin Patch\n*** Add File: .verid/manifest.yaml\u0085\n+x\n*** End Patch",
      "*** Begin Patch\n*** Update File: AGENTS.md\u0085\n@@\n-a\n+b\n*** End Patch",
      "*** Begin Patch\n*** Update File: test/a.ts\n*** Move to: src/a.ts\u0085\n@@\n-a\n+b\n*** End Patch",
      "*** Begin Patch\n*** Delete File: 　src/a.ts\n*** End Patch",
      "*** Begin Patch\n*** Add File: src/a\u001b.ts\n+x\n*** End Patch",
      "*** Begin Patch\n*** Add File: src/a.ts \n+x\n*** End Patch",
    ];
    for (const patch of rows) expect(parseApplyPatch(patch), patch).toHaveProperty("invalid");
  });
});
