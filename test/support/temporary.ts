import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach } from "vitest";

export interface CleanupOptions {
  maxRetries?: number;
  retryDelay?: number;
}

/** Own every scratch root, even when a test changes its working project directory. */
export function temporaryDirectories(prefix: string, cleanup: CleanupOptions = {}) {
  const roots: string[] = [];
  return {
    create(name = prefix, canonical = false): string {
      const created = mkdtempSync(join(tmpdir(), name));
      roots.push(created);
      return canonical ? realpathSync.native(created) : created;
    },
    cleanup(): void {
      for (const created of roots.splice(0).reverse()) {
        const target = resolve(created);
        if (dirname(target) !== resolve(tmpdir()))
          throw new Error("cleanup outside temporary directory");
        rmSync(target, { recursive: true, force: true, ...cleanup });
      }
    },
  };
}

/** Scratch directories for cases that manage more than one project or an install prefix. */
export function tempDirs(prefix: string, scope: "test" | "suite" = "test") {
  const dirs = temporaryDirectories(prefix);
  (scope === "suite" ? afterAll : afterEach)(dirs.cleanup);
  return dirs.create;
}
