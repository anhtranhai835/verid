import * as z from "zod/mini";
import { safeCloneRemote } from "./manifest.js";

export const PLUGIN_EVENTS = [
  "module-opened",
  "module-served",
  "taste",
  "drive-stuck",
  "drive-done",
] as const;
export type PluginEvent = (typeof PLUGIN_EVENTS)[number];

export const pluginName = (name: string): boolean =>
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) &&
  !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name);
const version = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;
const scriptPath = (path: string): boolean =>
  path
    .split(/[/\\]/)
    .every(
      (part) =>
        part !== "" &&
        part !== "." &&
        part !== ".." &&
        !/[<>:"|?*~\x00-\x1f]/.test(part) &&
        !/[. ]$|^\s/.test(part) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    );

const manifestSchema = z.strictObject({
  name: z.string().check(z.refine(pluginName)),
  version: z.string().check(z.regex(version)),
  events: z.partialRecord(z.enum(PLUGIN_EVENTS), z.string().check(z.refine(scriptPath))),
  requires: z._default(z.array(z.string().check(z.regex(/^[a-zA-Z0-9][\w.-]*$/))), []),
});
export type PluginManifest = z.infer<typeof manifestSchema>;
type Problem = {
  ok: false;
  code: "VERID_BURNT_PLUGIN_INVALID" | "VERID_BURNT_PLUGIN_SOURCE";
  detail: string;
};

export function parsePluginManifest(
  input: unknown,
): { ok: true; manifest: PluginManifest } | Problem {
  const result = manifestSchema.safeParse(input);
  if (result.success) return { ok: true, manifest: result.data };
  const issue = result.error.issues[0];
  return {
    ok: false,
    code: "VERID_BURNT_PLUGIN_INVALID",
    detail: `${issue?.path.join(".") ?? "manifest"}: ${issue?.message ?? "invalid"}`,
  };
}

export type PluginSource =
  | { kind: "file"; path: string }
  | { kind: "git"; remote: string; ref?: string }
  | { kind: "npm"; spec: string };

/** No registry shorthand. Bare package names are npm specs; folders use ./, ../ or file:. */
export function parsePluginSource(text: string): { ok: true; source: PluginSource } | Problem {
  const bad: Problem = {
    ok: false,
    code: "VERID_BURNT_PLUGIN_SOURCE",
    detail: "expected a local path, safe git URL or npm package spec",
  };
  if (!safeCloneRemote(text)) return bad;
  const git =
    /^(?:git:)(?!\/\/)/.test(text) || /^(?:https|ssh|git):\/\/|^[\w.-]+@[^/\\:]+:/.test(text);
  if (git) {
    const value = text.replace(/^git:(?!\/\/)/, "");
    const [remote = "", ref, ...extra] = value.split("#");
    if (
      !safeCloneRemote(remote) ||
      extra.length ||
      (/^[a-z][\w+.-]*:/i.test(remote) &&
        !/^(https|ssh|git|file):\/\/|^[a-z]:[/\\]|^[\w.-]+@[^/\\:]+:/i.test(remote)) ||
      (ref !== undefined && (!ref || /^[-\s]|[\s\x00-\x1f]/.test(ref)))
    )
      return bad;
    return { ok: true, source: { kind: "git", remote, ...(ref !== undefined && { ref }) } };
  }
  if (text.startsWith("file:") || /^\.{1,2}[/\\]|^[/\\]|^[a-z]:[/\\]/i.test(text)) {
    const path = text.replace(/^file:/, "");
    return safeCloneRemote(path) ? { ok: true, source: { kind: "file", path } } : bad;
  }
  const spec = text.replace(/^npm:/, "");
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9*^~<>=|. +_-]+)?$/.test(
    spec,
  )
    ? { ok: true, source: { kind: "npm", spec } }
    : bad;
}

const listSchema = z.array(
  z.strictObject({
    name: z.string().check(z.refine(pluginName)),
    source: z.string(),
    resolved: z.string(),
  }),
);
export type PluginEntry = z.infer<typeof listSchema>[number];

export function parsePluginList(input: unknown): { ok: true; plugins: PluginEntry[] } | Problem {
  const result = listSchema.safeParse(input);
  if (result.success) {
    const names = new Set<string>();
    const valid = result.data.every((entry) => {
      const source = parsePluginSource(entry.source);
      const unique = !names.has(entry.name);
      names.add(entry.name);
      return (
        unique &&
        source.ok &&
        (source.source.kind === "git"
          ? /^[a-f0-9]{40,64}$/.test(entry.resolved)
          : version.test(entry.resolved))
      );
    });
    if (valid) return { ok: true, plugins: result.data };
  }
  return {
    ok: false,
    code: "VERID_BURNT_PLUGIN_INVALID",
    detail:
      "plugins.json must contain distinct names, safe sources and resolved versions or commits",
  };
}
