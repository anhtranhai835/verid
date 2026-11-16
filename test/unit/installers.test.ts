import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("portable installer", () => {
  it("ships a POSIX shell entry point with LF line endings", () => {
    const text = readFileSync(join(import.meta.dirname, "../../install.sh"), "utf8");
    expect(text.startsWith("#!/bin/sh\n")).toBe(true);
    expect(text).not.toContain("\r");
  });

  it("keeps the shell installer LF-terminated after a Windows checkout", () => {
    const r = spawnSync("git", ["check-attr", "eol", "--", "install.sh"], {
      cwd: join(import.meta.dirname, "../.."),
      encoding: "utf8",
      windowsHide: true,
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("install.sh: eol: lf");
  });
});
