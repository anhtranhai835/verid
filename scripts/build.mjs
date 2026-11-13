// Usage: node scripts/build.mjs
// Bundles the hook and the CLI into dist/. An import that ends in `?raw` embeds that file as
// text: the board's page, styles and browser scripts in src/cli/board-ui/. One that ends in
// `?inline` embeds a picture as a data: URL, as Vitest does.
import { rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const raw = {
  name: "raw",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(dirname(args.importer), args.path.slice(0, -"?raw".length)),
      namespace: "raw",
    }));
    build.onResolve({ filter: /\?inline$/ }, (args) => ({
      path: resolve(dirname(args.importer), args.path.slice(0, -"?inline".length)),
      namespace: "inline",
    }));
    build.onLoad({ filter: /\.webp$/, namespace: "inline" }, async (args) => ({
      contents: `data:image/webp;base64,${(await readFile(args.path)).toString("base64")}`,
      loader: "text",
      watchFiles: [args.path],
    }));
    build.onLoad({ filter: /.*/, namespace: "raw" }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "text",
      watchFiles: [args.path],
    }));
  },
};

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
  plugins: [raw],
});
