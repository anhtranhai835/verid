import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { writeReviewPacket } from "../../src/adapters/review-packet.js";

it("refuses a linked review directory without writing outside the packet folder", () => {
  const project = mkdtempSync(join(tmpdir(), "verid-packet-link-"));
  try {
    mkdirSync(join(project, ".verid"));
    mkdirSync(join(project, "outside"));
    writeFileSync(join(project, "outside/work.md"), "untouched");
    symlinkSync(
      join(project, "outside"),
      join(project, ".verid/review"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => writeReviewPacket(project, "replacement")).toThrow("not a plain directory");
    expect(readFileSync(join(project, "outside/work.md"), "utf8")).toBe("untouched");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

it("replaces a packet's directory entry without overwriting a hard-linked file", () => {
  const project = mkdtempSync(join(tmpdir(), "verid-packet-hardlink-"));
  try {
    mkdirSync(join(project, ".verid/review"), { recursive: true });
    writeFileSync(join(project, "outside.md"), "untouched");
    linkSync(join(project, "outside.md"), join(project, ".verid/review/work.md"));
    expect(writeReviewPacket(project, "new packet")).toBe(".verid/review/work.md");
    expect(readFileSync(join(project, ".verid/review/work.md"), "utf8")).toBe("new packet");
    expect(readFileSync(join(project, "outside.md"), "utf8")).toBe("untouched");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

it("writes the history beside the packet when given one", () => {
  const project = mkdtempSync(join(tmpdir(), "verid-packet-history-"));
  try {
    expect(writeReviewPacket(project, "short packet", "full history")).toBe(
      ".verid/review/work.md",
    );
    expect(readFileSync(join(project, ".verid/review/work.md"), "utf8")).toBe("short packet");
    expect(readFileSync(join(project, ".verid/review/history.md"), "utf8")).toBe("full history");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
