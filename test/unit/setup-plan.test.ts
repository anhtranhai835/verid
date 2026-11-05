import { describe, expect, it } from "vitest";
import { isCi, setupPreview, type PlannedFile } from "../../src/core/setup-plan.js";

describe("isCi", () => {
  it("allows terminal setup for empty, false and zero CI values", () => {
    const rows = [
      { ci: undefined, want: false },
      { ci: "", want: false },
      { ci: "false", want: false },
      { ci: " FALSE ", want: false },
      { ci: "0", want: false },
      { ci: "true", want: true },
      { ci: "1", want: true },
    ];
    for (const { ci, want } of rows) expect(isCi(ci)).toBe(want);
  });
});

describe("setupPreview", () => {
  it("renders planned files as a tree with create, modify, keep and warning markers", () => {
    const rows: { files: PlannedFile[]; warnings: string[]; want: string[] }[] = [
      { files: [], warnings: [], want: ["."] },
      {
        files: [
          { rel: ".verid/manifest.yaml", action: "created" },
          { rel: ".verid/.state/state.json", action: "kept" },
          { rel: ".claude/settings.local.json", action: "updated" },
          { rel: ".claude/commands/verid/tip.md", action: "created" },
        ],
        warnings: ["Shared hooks also run."],
        want: [
          ".",
          "├── .verid/",
          "│   ├── + manifest.yaml",
          "│   └── .state/",
          "│       └── = state.json",
          "└── .claude/",
          "    ├── ~ settings.local.json",
          "    └── commands/",
          "        └── verid/",
          "            └── + tip.md",
          "! Shared hooks also run.",
        ],
      },
      {
        files: [{ rel: "file.txt", action: "kept" }],
        warnings: ["First line\nSecond line"],
        want: [".", "└── = file.txt", "! First line", "! Second line"],
      },
    ];
    for (const { files, warnings, want } of rows) {
      const before = JSON.stringify(files);
      expect(setupPreview(files, warnings)).toEqual(want);
      expect(JSON.stringify(files)).toBe(before);
    }
  });
});
