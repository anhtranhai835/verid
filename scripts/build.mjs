// Usage: node scripts/build.mjs
// Bundles the hook and the CLI into dist/.
import { rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints: { hook: "src/hook-entry.ts", cli: "src/cli/entry.ts" },
  bundle: true,
  splitting: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outdir: "dist",
  logLevel: "warning",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
