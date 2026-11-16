import * as z from "zod/mini";
import { safeCloneRemote } from "./manifest.js";

const PLUGIN_EVENTS = ["after-order", "on-state", "after-serve"] as const;
export type PluginEvent = (typeof PLUGIN_EVENTS)[number];
const text = z.string().check(z.minLength(1));
export const pluginNameSchema = text.check(
  z.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
  z.refine((name) => !/^(verid(?:-|$)|con$|prn$|aux$|nul$|com[1-9]$|lpt[1-9]$)/.test(name)),
);
const portablePath = text.check(
  z.refine((path) =>
    path
      .split("/")
      .every(
        (part) =>
          part !== "." &&
          part !== ".." &&
          part !== "" &&
          !/[\\<>:"|?*\x00-\x1f]/.test(part) &&
          !/[. ]$/.test(part) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      ),
  ),
);
const version = text.check(z.regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/));
const command = text.check(
  z.refine((value) => {
    try {
      pluginArgs(value);
      return true;
    } catch {
      return false;
    }
  }),
);
const jsonConfig = z.record(z.string(), z.json());

/**
 * What mode reheat runs to read a legacy system: one command per step. Placeholders
 * {legacyRoot}, {unit}, {unitDir} and {specPath} are filled after the command is split, so a path
 * with spaces stays one argument. `skill` names, without the plugin prefix, a skill of this
 * package that writes a unit's spec.
 */
const adapter = z.strictObject({
  unitKind: text,
  commands: z.strictObject({ inventory: command, extract: command, gate: command }),
  skill: z.optional(pluginNameSchema),
});
export type PluginAdapter = z.infer<typeof adapter>;

export const pluginManifestSchema = z
  .strictObject({
    name: pluginNameSchema,
    version,
    veridApi: z.literal("1"),
    description: text,
    requires: z._default(
      z.array(
        z.strictObject({
          bin: text.check(z.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)),
          version: z.optional(text.check(z.regex(/^(?:>=|<=|>|<|=|\^|~)?\d+\.\d+\.\d+$/))),
          install: z.optional(text),
        }),
      ),
      [],
    ),
    setup: z._default(z.array(command), []),
    hooks: z._default(z.partialRecord(z.enum(PLUGIN_EVENTS), command), {}),
    skills: z._default(z.array(portablePath), []),
    agents: z._default(z.array(portablePath), []),
    config: z._default(jsonConfig, {}),
    adapter: z.optional(adapter),
  })
  .check(
    z.refine(
      (manifest) =>
        manifest.adapter?.skill === undefined ||
        manifest.skills.some((path) => path.split("/").at(-1) === manifest.adapter?.skill),
    ),
  );
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

const entry = z
  .strictObject({
    name: pluginNameSchema,
    source: text.check(
      z.refine((value) => {
        try {
          pluginSource(value);
          return true;
        } catch {
          return false;
        }
      }),
    ),
    version,
    commit: z.optional(text.check(z.regex(/^[a-f0-9]{40}$/))),
    integrity: text.check(z.regex(/^[a-f0-9]{64}$/)),
    config: jsonConfig,
    enabled: z.boolean(),
    skills: z.array(pluginNameSchema),
    agents: z.array(pluginNameSchema),
    files: z.array(portablePath),
  })
  .check(
    z.refine((value) => !value.source.startsWith("git:") || value.commit !== undefined),
    z.refine((value) =>
      [...value.skills, ...value.agents].every((name) => name.startsWith(`${value.name}-`)),
    ),
  );
export type PluginEntry = z.infer<typeof entry>;
export const pluginsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  plugins: z
    .array(entry)
    .check(z.refine((entries) => new Set(entries.map((p) => p.name)).size === entries.length)),
});
export type Plugins = z.infer<typeof pluginsSchema>;

/** Quotes group arguments; characters such as $, ; and | remain literal arguments. */
export function pluginArgs(command: string): string[] {
  const args: string[] = [];
  let word = "",
    quote = "",
    started = false;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = "";
      else word += char;
      started = true;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        args.push(word);
        word = "";
        started = false;
      }
    } else {
      word += char;
      started = true;
    }
  }
  if (quote) throw new Error("Unclosed command quote");
  if (started) args.push(word);
  if (!args[0] || args.some((arg) => /[\x00\r\n]/.test(arg)))
    throw new Error("Invalid plugin command");
  return args;
}

export function pluginSource(
  source: string,
): { kind: "file"; path: string } | { kind: "git"; url: string; ref: string } {
  if (source.startsWith("file:") && source.slice(5).trim() && !/[\x00\r\n]/.test(source))
    return { kind: "file", path: source.slice(5) };
  const git = /^git:(.+)#([^#]+)$/.exec(source);
  if (git && safeCloneRemote(git[1]!) && !/\s|[\x00-\x1f]|^[-.]/.test(git[2]!))
    return { kind: "git", url: git[1]!, ref: git[2]! };
  throw new Error("Use file:<directory> or git:<url>#<ref>");
}

export function pluginVersionMatches(actual: string, required: string): boolean {
  const found = /\d+\.\d+\.\d+/.exec(actual)?.[0];
  const [, op = "", wanted = ""] = /^(>=|<=|>|<|=|\^|~)?(\d+\.\d+\.\d+)$/.exec(required) ?? [];
  if (!found || !wanted) return false;
  const a = found.split(".").map(Number),
    b = wanted.split(".").map(Number);
  const index = a.findIndex((n, i) => n !== b[i]);
  const cmp = index === -1 ? 0 : a[index]! > b[index]! ? 1 : -1;
  if (op === ">=") return cmp >= 0;
  if (op === "<=") return cmp <= 0;
  if (op === ">") return cmp > 0;
  if (op === "<") return cmp < 0;
  if (op === "~") return cmp >= 0 && a[0] === b[0] && a[1] === b[1];
  if (op === "^")
    return (
      cmp >= 0 && a[0] === b[0] && (b[0] !== 0 || (a[1] === b[1] && (b[1] !== 0 || a[2] === b[2])))
    );
  return cmp === 0;
}
