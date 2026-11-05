import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CODEX_HOOK_EVENTS = [
  "PreToolUse",
  "UserPromptSubmit",
  "Stop",
  "SubagentStop",
  "SessionStart",
] as const;
export const codexHome = (): string => process.env.CODEX_HOME || join(homedir(), ".codex");
export function installationRoot(): string {
  const folder = dirname(fileURLToPath(import.meta.url));
  return basename(folder) === "adapters" && basename(dirname(folder)) === "src"
    ? join(folder, "..", "..")
    : join(folder, "..");
}
export const installedSkills = (): string => join(installationRoot(), "plugin", "skills");
export const reviewerOverlay = (): string =>
  join(installationRoot(), "dist", "codex-reviewer.toml");

export function reviewerContent(): string {
  const template = readFileSync(
    join(installationRoot(), "plugin", "codex", "verid-reviewer.toml"),
    "utf8",
  );
  const skill = (name: string) => join(installedSkills(), name, "SKILL.md").replaceAll("\\", "/");
  return template
    .replace("{{REVIEW_SKILL}}", () => skill("review"))
    .replace("{{SECURITY_SKILL}}", () => skill("security"));
}

/** Codex reads command text, including a PowerShell call operator on Windows. */
function handler(hook: string, node: string) {
  const quote = (value: string) => `"${value.replace(/[\\"$`]/g, (char) => `\\${char}`)}"`;
  const windowsQuote = (value: string) => `"${value.replace(/["$`]/g, (char) => `\u0060${char}`)}"`;
  const command = `${quote(node)} ${quote(hook)} --provider codex`;
  return {
    type: "command",
    command,
    commandWindows: `& ${windowsQuote(node)} ${windowsQuote(hook)} --provider codex`,
    timeout: 10,
    statusMessage: "verid",
  };
}

export function withCodexHooks(
  settings: unknown,
  hook: string,
  node = process.execPath,
): { settings: Record<string, unknown>; changed: boolean } {
  if (!object(settings)) throw new Error("settings: expected a JSON object");
  const hooks = settings.hooks ?? {};
  if (!object(hooks)) throw new Error("hooks: expected a JSON object");
  const next: Record<string, unknown> = { ...hooks };
  for (const event of CODEX_HOOK_EVENTS) {
    const groups = hooks[event] ?? [];
    if (!Array.isArray(groups)) throw new Error(`hooks.${event}: expected a list`);
    const kept: unknown[] = [];
    for (const group of groups) {
      if (!object(group) || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const others = group.hooks.filter((h) => !verid(h, hook));
      if (others.length) kept.push({ ...group, hooks: others });
    }
    next[event] = [
      ...kept,
      { ...(event === "PreToolUse" && { matcher: "*" }), hooks: [handler(hook, node)] },
    ];
  }
  const result = { ...settings, hooks: next };
  return { settings: result, changed: JSON.stringify(result) !== JSON.stringify(settings) };
}

export function hasCurrentCodexHooks(
  settings: unknown,
  hook: string,
  node = process.execPath,
): boolean {
  if (!object(settings) || !object(settings.hooks)) return false;
  const expected = handler(hook, node);
  return CODEX_HOOK_EVENTS.every((event) => {
    const groups = (settings.hooks as Record<string, unknown>)[event];
    return (
      Array.isArray(groups) &&
      groups.some(
        (group) =>
          object(group) &&
          (event !== "PreToolUse" || group.matcher === "*" || !group.matcher) &&
          Array.isArray(group.hooks) &&
          group.hooks.some(
            (h) => object(h) && Object.entries(expected).every(([key, value]) => h[key] === value),
          ),
      )
    );
  });
}

/** Trust keys use the actual group/handler positions, including the user's hooks. */
export function codexHookKeys(settings: unknown, file: string, hook: string): string[] {
  if (!object(settings) || !object(settings.hooks)) return [];
  return CODEX_HOOK_EVENTS.flatMap((event) => {
    const groups = (settings.hooks as Record<string, unknown>)[event];
    const name = event.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    return Array.isArray(groups)
      ? groups.flatMap((group, gi) =>
          object(group) && Array.isArray(group.hooks)
            ? group.hooks.flatMap((h, hi) =>
                verid(h, hook) ? [`${file}:${name}:${gi}:${hi}`] : [],
              )
            : [],
        )
      : [];
  });
}

const BEGIN = "# verid:begin";
const END = "# verid:end";

/** Only this exact marked span belongs to verid; unrelated TOML is never serialized. */
export function mergeCodexReviewer(
  old: string | undefined,
  overlay: string,
): { ok: true; content: string } | { ok: false; detail: string } {
  const text = old ?? "";
  const lines = tomlLines(text);
  const begins = lines.filter((line) => line.text.trim() === BEGIN);
  const ends = lines.filter((line) => line.text.trim() === END);
  const begin = begins[0]?.offset ?? -1,
    end = ends[0]?.offset ?? -1;
  const after = end + (ends[0]?.text.length ?? 0);
  if (begin < 0 !== end < 0 || end < begin || begins.length > 1 || ends.length > 1)
    return { ok: false, detail: "expected one ordered verid:begin/verid:end marker pair" };
  const outside = begin < 0 ? text : text.slice(0, begin) + text.slice(after);
  if (
    tomlSections(outside).some(
      ({ path, definitions }) => reviewerPath(path) || definitions.some(reviewerPath),
    )
  )
    return { ok: false, detail: "agents.verid_reviewer already exists outside the verid block" };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const block = [
    BEGIN,
    "[agents.verid_reviewer]",
    'description = "Read-only review of verid acceptance criteria and the diff"',
    `config_file = ${JSON.stringify(overlay)}`,
    END,
  ].join(eol);
  return {
    ok: true,
    content:
      begin < 0
        ? `${text}${text === "" ? "" : text.endsWith("\n") ? eol : eol + eol}${block}${eol}`
        : text.slice(0, begin) + block + text.slice(after),
  };
}

export function hasCodexReviewer(text: string, overlay: string): boolean {
  const sections = tomlSections(text).filter(({ path }) => path.length === 2 && reviewerPath(path));
  return (
    sections.length === 1 &&
    sections[0]?.values.config_file === overlay &&
    typeof sections[0]?.values.description === "string"
  );
}

/** Inspect only string settings needed for diagnostics; unsupported syntax fails closed. */
function tomlSections(text: string): {
  path: string[];
  values: Record<string, string>;
  definitions: string[][];
}[] {
  const sections = [
    { path: [] as string[], values: {} as Record<string, string>, definitions: [] as string[][] },
  ];
  let current: (typeof sections)[number] | undefined = sections[0];
  for (const { text: line } of tomlLines(text)) {
    const header = /^\s*\[([^\n]+)\]\s*(?:#.*)?$/.exec(line);
    if (header) {
      const path = tomlPath(header[1]!);
      current = path ? { path, values: {}, definitions: [] } : undefined;
      if (current) sections.push(current);
      continue;
    }
    const assignment =
      /^\s*((?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)(?:\s*\.\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+))*)\s*=/.exec(
        line,
      );
    const key = assignment && tomlPath(assignment[1]!);
    if (current && key) current.definitions.push([...current.path, ...key]);
    const entry = /^\s*([A-Za-z0-9_-]+)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/.exec(line);
    if (current && entry) {
      const value = tomlString(entry[2]!);
      if (value !== null) current.values[entry[1]!] = value;
    }
  }
  return sections;
}
function reviewerPath(path: string[]): boolean {
  return path[0] === "agents" && path[1] === "verid_reviewer";
}
function tomlPath(text: string): string[] | null {
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+|\./g);
  if (
    !tokens ||
    tokens.length % 2 !== 1 ||
    tokens.join("").replace(/\s/g, "") !== text.replace(/\s/g, "")
  )
    return null;
  const path: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i % 2 === 1) {
      if (tokens[i] !== ".") return null;
    } else {
      const value = tomlString(tokens[i]!);
      if (value === null && !/^[A-Za-z0-9_-]+$/.test(tokens[i]!)) return null;
      path.push(value ?? tokens[i]!);
    }
  }
  return path;
}

/** Ignore table/marker-looking text in multiline strings while keeping exact source offsets. */
function tomlLines(text: string): { text: string; offset: number }[] {
  const lines: { text: string; offset: number }[] = [];
  let multiline: string | undefined;
  for (const match of text.matchAll(/([^\r\n]*)(?:\r\n|\n|\r|$)/g)) {
    const line = match[1]!;
    if (!multiline) lines.push({ text: line, offset: match.index! });
    for (let i = 0; i < line.length;) {
      if (multiline) {
        if (multiline === '"""' && line[i] === "\\") i += 2;
        else if (line.startsWith(multiline, i)) {
          i += 3;
          multiline = undefined;
        } else i++;
      } else if (line[i] === "#") break;
      else if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
        multiline = line.slice(i, i + 3);
        i += 3;
      } else if (line[i] === '"' || line[i] === "'") {
        const quote = line[i++]!;
        while (i < line.length) {
          if (quote === '"' && line[i] === "\\") i += 2;
          else if (line[i++] === quote) break;
        }
      } else i++;
    }
  }
  return lines;
}
function tomlString(value: string): string | null {
  if (value.startsWith("'")) return value.slice(1, -1);
  try {
    return value.startsWith('"') ? (JSON.parse(value) as string) : null;
  } catch {
    return null;
  }
}

export function codexTrust(
  text: string,
  project: string,
  keys: readonly string[],
): { project: boolean; hooks: boolean } {
  const key = (path: string) => path.replaceAll("\\", "/").toLowerCase();
  const sections = tomlSections(text);
  return {
    project: sections.some(
      (section) =>
        section.path.length === 2 &&
        section.path[0] === "projects" &&
        key(section.path[1]!) === key(project) &&
        section.values.trust_level === "trusted",
    ),
    hooks:
      keys.length > 0 &&
      keys.every((name) =>
        sections.some(
          (section) =>
            section.path.length === 3 &&
            section.path[0] === "hooks" &&
            section.path[1] === "state" &&
            key(section.path[2]!) === key(name) &&
            /^sha256:[a-f0-9]+$/i.test(section.values.trusted_hash ?? ""),
        ),
      ),
  };
}

function verid(value: unknown, hook: string): boolean {
  return (
    object(value) &&
    (value.statusMessage === "verid" ||
      [value.command, value.commandWindows].some(
        (command) =>
          typeof command === "string" &&
          (command.includes(hook) || /verid.*[\\/]dist[\\/]hook\.js/i.test(command)),
      ))
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
