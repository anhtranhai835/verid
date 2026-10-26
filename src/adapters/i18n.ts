import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The developer picks one language at `verid cook` (state.json); until then messages show both.
export type Lang = "vi" | "en";
const catalogs = new Map<Lang, Record<string, string>>();

// Paths are resolved from the bundle in dist/ (from src/ only in unit tests).

/**
 * How messages name the CLI as {verid}: `verid` when npm installed this copy globally, so the
 * `verid` on PATH runs it (npm's shim sits next to node_modules on Windows, in ../bin elsewhere);
 * otherwise the command that works as is, without `npm link`.
 */
export function veridCommand(cli: string, exists: (path: string) => boolean): string {
  const path = cli.replaceAll("\\", "/");
  const at = path.lastIndexOf("/node_modules/");
  if (at >= 0) {
    const prefix = path.slice(0, at);
    const up = prefix.slice(0, prefix.lastIndexOf("/"));
    if (exists(`${prefix}/verid.cmd`) || exists(`${up}/bin/verid`)) return "verid";
  }
  return `node "${path}"`;
}

// Worked out once, and only when a message names the CLI. From dist/ the CLI sits beside this
// chunk; from src/adapters/ (tests in process) it is the build in dist/.
let verid: string | undefined;
export const veridName = () => {
  const [beside, built] = ["./cli.js", "../../dist/cli.js"].map((path) =>
    fileURLToPath(new URL(path, import.meta.url)),
  );
  return (verid ??= veridCommand(
    existsSync(beside!) || !existsSync(built!) ? beside! : built!,
    existsSync,
  ));
};

export function t(lang: Lang, key: string, params: Record<string, string>): string {
  if (!catalogs.has(lang)) {
    // From dist/ the catalogs are one level up; from src/adapters/ (unit tests) two.
    const found = ["../i18n/", "../../i18n/"].flatMap((dir) => {
      try {
        const url = new URL(`${dir}${lang}.json`, import.meta.url);
        return [JSON.parse(readFileSync(url, "utf8")) as Record<string, string>];
      } catch {
        return []; // a missing catalog must not turn a deny into a crash
      }
    });
    catalogs.set(lang, found[0] ?? {});
  }
  const template = catalogs.get(lang)?.[key] ?? key;
  // A `detail_key` names a message for {detail}, so the detail is in the same language too.
  const { detail_key, ...rest } = params;
  const detail = detail_key ? { detail: t(lang, detail_key, rest) } : {};
  const all: Record<string, string> = { ...params, ...detail };
  return template.replace(
    /\{(\w+)\}/g,
    (m, name: string) => all[name] ?? (name === "verid" ? veridName() : m),
  );
}

// The language the developer chose at `verid cook`, once the project is known; null prints both.
let chosen: Lang | null = null;
export const setLanguage = (lang: Lang | null): void => {
  chosen = lang;
};

/** A message in the chosen language alone, or in both, each line prefixed, when none is set. */
export const inLanguage = (render: (lang: Lang) => string): string =>
  chosen ? render(chosen) : `vi: ${render("vi")}\nen: ${render("en")}`;

export const bilingual = (key: string, params: Record<string, string>) =>
  inLanguage((lang) => t(lang, key, params));
