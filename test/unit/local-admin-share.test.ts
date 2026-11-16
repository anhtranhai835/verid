import { hostname } from "node:os";
import { describe, expect, it } from "vitest";
import { normalizePath, writtenPath } from "../../src/adapters/claude-code.js";

describe.skipIf(process.platform !== "win32")("administrative drive share paths", () => {
  it("normalizes administrative shares on any host to drive paths before resolving aliases", () => {
    const rows = [
      [
        "\\\\localhost\\C$\\verid-admin-share-fixture\\new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "\\\\127.0.0.1\\C$\\verid-admin-share-fixture\\new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        `\\\\${hostname()}\\C$\\verid-admin-share-fixture\\new.txt`,
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "\\\\?\\UNC\\localhost\\C$\\verid-admin-share-fixture\\new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "//localhost/C$/verid-admin-share-fixture/new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "//127.0.0.1/C$/verid-admin-share-fixture/new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        `//${hostname().toUpperCase()}/c$/verid-admin-share-fixture/new.txt`,
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "//?/UNC/localhost/C$/verid-admin-share-fixture/new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "\\\\.\\UNC\\localhost\\C$\\verid-admin-share-fixture\\new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "//./UNC/localhost/C$/verid-admin-share-fixture/new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      ["\\\\::1\\C$\\verid-admin-share-fixture\\new.txt", "c:\\verid-admin-share-fixture\\new.txt"],
      [
        "\\\\[::1]\\C$\\verid-admin-share-fixture\\new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "\\\\remote.invalid\\C$\\verid-admin-share-fixture\\new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "//remote.invalid/C$/verid-admin-share-fixture/new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "\\\\?\\UNC\\remote.invalid\\C$\\verid-admin-share-fixture\\new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "//./uNc/Arbitrary-Host/c$\\verid-admin-share-fixture/new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "\\\\192.0.2.1\\C$\\verid-admin-share-fixture\\new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "\\\\2001:db8::1\\C$\\verid-admin-share-fixture\\new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "//?/uNc/[2001:db8::1]/c$/verid-admin-share-fixture/new.txt",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
      ["\\\\remote.invalid\\C$", "c:\\"],
      [
        "\\\\LOCALHOST\\D$\\verid-admin-share-fixture\\new.txt",
        "d:\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "\\\\localhost\\C$\\verid-admin-share-fixture\\sub\\..\\new.txt:stream",
        "c:\\verid-admin-share-fixture\\new.txt",
      ],
    ] as const;
    for (const [path, expected] of rows) {
      expect.soft(writtenPath(path), `written ${path}`).toBe(expected);
      expect.soft(normalizePath(path), `normalized ${path}`).toBe(expected);
    }
  });

  it("keeps non-administrative shares as UNC paths", () => {
    const rows = [
      [
        "\\\\remote.invalid\\shared\\verid-admin-share-fixture\\new.txt",
        "\\\\remote.invalid\\shared\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "//remote.invalid/shared/verid-admin-share-fixture/new.txt",
        "\\\\remote.invalid\\shared\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "\\\\?\\UNC\\remote.invalid\\shared\\verid-admin-share-fixture\\new.txt",
        "\\\\?\\unc\\remote.invalid\\shared\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "\\\\localhost\\shared\\verid-admin-share-fixture\\new.txt",
        "\\\\localhost\\shared\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "\\\\remote.invalid\\C$backup\\verid-admin-share-fixture\\new.txt",
        "\\\\remote.invalid\\c$backup\\verid-admin-share-fixture\\new.txt",
      ],
      [
        "\\\\remote.invalid\\CC$\\verid-admin-share-fixture\\new.txt",
        "\\\\remote.invalid\\cc$\\verid-admin-share-fixture\\new.txt",
      ],
    ] as const;
    for (const [path, expected] of rows) expect(writtenPath(path), path).toBe(expected);
  });
});
