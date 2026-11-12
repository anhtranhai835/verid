import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  pluginManifestSchema,
  pluginNameSchema,
  pluginsSchema,
  pluginSource,
  pluginVersionMatches,
  type PluginEntry,
  type PluginManifest,
  type Plugins,
} from "../core/plugin.js";
import type { Manifest } from "../core/manifest.js";
import { resourceTree, type ResourceFile } from "./repo-resources.js";
import { checkSetupPath } from "./workspace.js";
import { loadManifest } from "./manifest.js";
import { errno, statePaths, VeridError, withLock } from "./state-store.js";
import { ask, type Io } from "./terminal.js";
import { bilingual } from "./i18n.js";
import { runPluginCommand } from "./plugin-process.js";

export const pluginsFile = (project: string) => join(project, ".verid/plugins.json");
export const pluginFolder = (project: string, name: string) => {
  pluginNameSchema.parse(name);
  checkSetupPath(project, `.verid/.plugins/${name}`);
  return join(project, ".verid/.plugins", name);
};
const invalid = (path: string, detail: string) =>
  new VeridError("VERID_BURNT_PLUGIN_INVALID", { path, detail });

export function readPlugins(project: string): Plugins {
  checkSetupPath(project, ".verid/plugins.json");
  try {
    return pluginsSchema.parse(JSON.parse(readFileSync(pluginsFile(project), "utf8")));
  } catch (error) {
    if (errno(error) === "ENOENT") return { schemaVersion: 1, plugins: [] };
    throw invalid(pluginsFile(project), error instanceof Error ? error.message : String(error));
  }
}

function writePlugins(project: string, value: Plugins): void {
  checkSetupPath(project, ".verid/plugins.json");
  const temp = `${pluginsFile(project)}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(pluginsSchema.parse(value), null, 2) + "\n", { flag: "wx" });
    renameSync(temp, pluginsFile(project));
  } finally {
    rmSync(temp, { force: true });
  }
}

export function readPluginManifest(folder: string): PluginManifest {
  checkSetupPath(folder, "verid-plugin.json");
  const path = join(folder, "verid-plugin.json");
  try {
    return pluginManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw invalid(path, error instanceof Error ? error.message : String(error));
  }
}

function packageFiles(folder: string): ResourceFile[] {
  return resourceTree(folder, "", new Set([".git"]))
    .map((file) => ({ ...file, rel: file.rel.slice(1) }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}
export function pluginIntegrity(folder: string): string {
  const hash = createHash("sha256");
  for (const file of packageFiles(folder))
    hash.update(file.rel).update("\0").update(file.content).update("\0");
  return hash.digest("hex");
}

export function checkedPlugin(
  project: string,
  entry: PluginEntry,
): { folder: string; manifest: PluginManifest } {
  const folder = pluginFolder(project, entry.name);
  const manifest = readPluginManifest(folder);
  if (
    manifest.name !== entry.name ||
    manifest.version !== entry.version ||
    pluginIntegrity(folder) !== entry.integrity
  )
    throw new VeridError("VERID_BURNT_PLUGIN_INTEGRITY", {
      name: entry.name,
      detail: "name, version or integrity differs from plugins.json",
    });
  return { folder, manifest };
}

export function pluginEnvironment(
  project: string,
  name: string,
  folder: string,
  config: PluginEntry["config"],
): NodeJS.ProcessEnv {
  const data = `.verid/.plugin-data/${name}`;
  checkSetupPath(project, data);
  mkdirSync(join(project, data), { recursive: true });
  return {
    VERID_PROJECT: project,
    VERID_PLUGIN_DIR: folder,
    VERID_PLUGIN_DATA: join(project, data),
    VERID_PLUGIN_CONFIG: JSON.stringify(config),
  };
}

export async function missingRequirements(
  manifest: PluginManifest,
  cwd: string,
): Promise<string[]> {
  const missing: string[] = [];
  for (const requirement of manifest.requires) {
    const result = await runPluginCommand(`${requirement.bin} --version`, cwd, {}, "", 10_000);
    if (
      result.exit !== 0 ||
      (requirement.version &&
        !pluginVersionMatches(result.stdout + result.stderr, requirement.version))
    )
      missing.push(
        `${requirement.bin}${requirement.version ? ` ${requirement.version}` : ""}${requirement.install ? ` (${requirement.install})` : ""}`,
      );
  }
  return missing;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", ["-c", "core.autocrlf=false", ...args], {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "https:ssh:git:file" },
  });
  if (result.status !== 0 || result.error)
    throw new VeridError("VERID_BURNT_PLUGIN_SOURCE", {
      detail: result.error?.message ?? result.stderr.trim(),
    });
  return result.stdout.trim();
}

function resources(
  folder: string,
  manifest: PluginManifest,
  providers: Manifest["providers"],
): { files: ResourceFile[]; skills: string[]; agents: string[] } {
  const files: ResourceFile[] = [],
    skills: string[] = [],
    agents: string[] = [];
  const header = (content: string | Buffer, name: string) => {
    const text = content.toString();
    if (!/^---\r?\n[\s\S]*?^name:\s*.+[\s\S]*?\r?\n---/m.test(text))
      throw invalid(folder, `resource ${name} needs frontmatter with a name`);
    return text.replace(
      /^(---\r?\n)([\s\S]*?)(\r?\n---)/,
      (_, open: string, body: string, close: string) =>
        open + body.replace(/^name:.*$/m, `name: ${name}`) + close,
    );
  };
  for (const path of manifest.skills) {
    checkSetupPath(folder, path);
    const name = `${manifest.name}-${basename(path)}`;
    pluginNameSchema.parse(name);
    if (skills.includes(name)) throw invalid(folder, `duplicate skill ${name}`);
    skills.push(name);
    const tree = resourceTree(join(folder, path), "");
    if (!tree.some((file) => file.rel === "/SKILL.md"))
      throw invalid(folder, `${path}/SKILL.md missing`);
    for (const file of tree) {
      const content = file.rel === "/SKILL.md" ? header(file.content, name) : file.content;
      files.push({ rel: `.verid/skills/${name}${file.rel}`, content });
      if (providers.includes("claude-code"))
        files.push({ rel: `.claude/skills/${name}${file.rel}`, content });
      if (providers.includes("codex"))
        files.push({ rel: `.agents/skills/${name}${file.rel}`, content });
    }
  }
  for (const path of manifest.agents) {
    checkSetupPath(folder, path);
    if (!path.endsWith(".md")) throw invalid(folder, "agent paths must name Markdown files");
    const name = `${manifest.name}-${basename(path, ".md")}`;
    pluginNameSchema.parse(name);
    if (agents.includes(name)) throw invalid(folder, `duplicate agent ${name}`);
    agents.push(name);
    const content = header(readFileSync(join(folder, path)), name);
    files.push({ rel: `.verid/agents/${name}.md`, content });
    if (providers.includes("claude-code"))
      files.push({ rel: `.claude/agents/${name}.md`, content });
  }
  return { files, skills, agents };
}

export async function installPlugin(
  project: string,
  source: string,
  options: { yes?: boolean; io?: Io | undefined; restore?: PluginEntry } = {},
): Promise<{ cancelled: boolean; name: string }> {
  let parsed: ReturnType<typeof pluginSource>;
  try {
    parsed = pluginSource(source);
  } catch (error) {
    throw new VeridError("VERID_BURNT_PLUGIN_SOURCE", { detail: String(error) });
  }
  const base = ".verid/.plugins";
  checkSetupPath(project, base);
  mkdirSync(join(project, base), { recursive: true });
  const temp = mkdtempSync(join(project, base, ".install-"));
  const folder = join(temp, "code");
  const copied: string[] = [];
  let installed: string | undefined,
    registered = false;
  try {
    let commit: string | undefined;
    if (parsed.kind === "file") {
      const from = resolve(project, parsed.path);
      if (!lstatSync(from).isDirectory() || lstatSync(from).isSymbolicLink())
        throw invalid(from, "source must be a directory without links");
      if (folder.startsWith(from + "/") || folder.startsWith(from + "\\"))
        throw invalid(from, "source contains installation directory");
      mkdirSync(folder);
      for (const file of packageFiles(from)) {
        mkdirSync(dirname(join(folder, file.rel)), { recursive: true });
        writeFileSync(join(folder, file.rel), file.content);
      }
    } else {
      const ref = options.restore?.commit ?? parsed.ref;
      const sha = /^[a-f0-9]{40}$/.test(ref);
      const url =
        !/^[a-z][\w+.-]*:\/\//i.test(parsed.url) && !/^[^/\\]+@[^/\\:]+:/.test(parsed.url)
          ? resolve(project, parsed.url)
          : parsed.url;
      git(temp, ["clone", "--depth", "1", ...(sha ? [] : ["--branch", ref]), "--", url, folder]);
      if (sha) {
        git(folder, ["fetch", "--depth", "1", "origin", ref]);
        git(folder, ["checkout", "--detach", ref]);
      }
      commit = git(folder, ["rev-parse", "HEAD"]);
    }
    const manifest = readPluginManifest(folder);
    const name = manifest.name;
    const integrity = pluginIntegrity(folder);
    const restore = options.restore;
    if (
      restore &&
      (restore.name !== name ||
        restore.version !== manifest.version ||
        restore.integrity !== integrity)
    )
      throw new VeridError("VERID_BURNT_PLUGIN_INTEGRITY", {
        name,
        detail: "restored source differs from the approved copy",
      });
    const destination = pluginFolder(project, name);
    if (existsSync(destination))
      throw invalid(destination, "already installed; remove before adding again");
    if (!restore && readPlugins(project).plugins.some((p) => p.name === name))
      throw invalid(destination, "already registered; run cook to restore missing code");
    const missing = await missingRequirements(manifest, folder);
    if (missing.length)
      throw new VeridError("VERID_BURNT_PLUGIN_REQUIRES", { name, tools: missing.join(", ") });
    const providers = (await loadManifest(project))?.providers ?? ["claude-code"];
    const resource = resources(folder, manifest, providers);
    for (const file of resource.files) {
      checkSetupPath(project, file.rel);
      if (existsSync(join(project, file.rel)) && !restore?.files.includes(file.rel))
        throw invalid(file.rel, "resource already exists");
    }
    const preview =
      [
        `Plugin ${name}@${manifest.version}`,
        `Source: ${source}${commit ? ` (${commit})` : ""}`,
        ...manifest.setup.map((cmd) => `setup: ${cmd}`),
        ...Object.entries(manifest.hooks).map(([event, cmd]) => `${event}: ${cmd}`),
      ].join("\n") + "\n";
    (options.io?.output ?? process.stdout).write(preview);
    const needsConfirmation = !restore || parsed.kind === "git";
    if (!options.yes && needsConfirmation) {
      if (!options.io) throw new VeridError("VERID_BURNT_PLUGIN_CONFIRM");
      const answer = await ask(options.io, bilingual("plugin.confirm", {}));
      if (!answer || !["y", "yes"].includes(answer.toLowerCase())) return { cancelled: true, name };
    }
    const config = restore?.config ?? manifest.config;
    const env = pluginEnvironment(project, name, folder, config);
    for (const command of manifest.setup) {
      const result = await runPluginCommand(command, project, env);
      if (result.exit !== 0)
        throw invalid(
          name,
          result.timedOut ? "setup timed out" : `setup exited ${result.exit}: ${result.stderr}`,
        );
    }
    if (pluginIntegrity(folder) !== integrity)
      throw invalid(name, "setup modified the approved plugin package");
    const entry: PluginEntry = {
      name,
      version: manifest.version,
      source,
      ...(commit && { commit }),
      integrity,
      config,
      enabled: restore?.enabled ?? true,
      skills: resource.skills,
      agents: resource.agents,
      files: [...new Set([...(restore?.files ?? []), ...resource.files.map((file) => file.rel)])],
    };
    withLock(statePaths(project), () => {
      const registry = readPlugins(project);
      if (
        restore
          ? JSON.stringify(registry.plugins.find((p) => p.name === name)) !==
            JSON.stringify(restore)
          : registry.plugins.some((p) => p.name === name)
      )
        throw invalid(name, "registration changed during setup; retry");
      checkSetupPath(project, `.verid/.plugins/${name}`);
      if (existsSync(destination)) throw invalid(destination, "installation changed during setup");
      renameSync(folder, destination);
      installed = destination;
      for (const file of resource.files) {
        checkSetupPath(project, file.rel);
        if (existsSync(join(project, file.rel))) {
          if (
            !restore?.files.includes(file.rel) ||
            !readFileSync(join(project, file.rel)).equals(Buffer.from(file.content))
          )
            throw invalid(file.rel, "resource differs from the approved copy");
          continue;
        }
        mkdirSync(dirname(join(project, file.rel)), { recursive: true });
        writeFileSync(join(project, file.rel), file.content, { flag: "wx" });
        copied.push(file.rel);
      }
      checkSetupPath(project, ".verid/.gitignore");
      const ignore = join(project, ".verid/.gitignore");
      const before = existsSync(ignore) ? readFileSync(ignore, "utf8") : ".state/\n";
      if (!/^\/?\.plugins\/$/m.test(before))
        writeFileSync(ignore, before + (before.endsWith("\n") ? "" : "\n") + ".plugins/\n");
      writePlugins(project, {
        schemaVersion: 1,
        plugins: [...registry.plugins.filter((p) => p.name !== name), entry],
      });
      registered = true;
    });
    return { cancelled: false, name };
  } catch (error) {
    if (error instanceof VeridError) throw error;
    throw invalid(source, error instanceof Error ? error.message : String(error));
  } finally {
    if (!registered) {
      for (const path of copied) {
        checkSetupPath(project, path);
        rmSync(join(project, path), { force: true });
      }
      if (installed) rmSync(installed, { recursive: true, force: true });
    }
    rmSync(temp, { recursive: true, force: true });
  }
}

export function removePlugin(project: string, name: string): void {
  if (!pluginNameSchema.safeParse(name).success)
    throw invalid(name, "expected a plugin name in kebab-case");
  withLock(statePaths(project), () => {
    const registry = readPlugins(project);
    const entry = registry.plugins.find((p) => p.name === name);
    if (!entry) throw invalid(name, "not registered");
    const owned = (path: string) =>
      entry.skills.some((skill) =>
        [`.verid/skills/${skill}/`, `.claude/skills/${skill}/`, `.agents/skills/${skill}/`].some(
          (prefix) => path.startsWith(prefix),
        ),
      ) ||
      entry.agents.some(
        (agent) => path === `.verid/agents/${agent}.md` || path === `.claude/agents/${agent}.md`,
      );
    for (const file of entry.files) {
      if (!owned(file)) throw invalid(file, "not an owned resource");
      checkSetupPath(project, file);
    }
    const folder = pluginFolder(project, name);
    for (const file of entry.files) rmSync(join(project, file), { force: true });
    rmSync(folder, { recursive: true, force: true });
    writePlugins(project, {
      ...registry,
      plugins: registry.plugins.filter((p) => p.name !== name),
    });
  });
}

export async function restorePlugins(project: string, yes: boolean, io?: Io): Promise<void> {
  for (const entry of readPlugins(project).plugins)
    if (!existsSync(pluginFolder(project, entry.name)))
      await installPlugin(project, entry.source, { yes, io, restore: entry });
}

export async function pluginProblems(project: string, ci = false): Promise<string[]> {
  const problems: string[] = [];
  for (const entry of readPlugins(project).plugins) {
    if (ci) continue;
    try {
      const folder = pluginFolder(project, entry.name);
      if (!existsSync(folder)) {
        problems.push(`${entry.name}: missing code; run verid cook --yes`);
        continue;
      }
      const manifest = readPluginManifest(folder);
      if (manifest.version !== entry.version)
        problems.push(`${entry.name}: version ${manifest.version} differs from ${entry.version}`);
      checkedPlugin(project, entry);
      for (const missing of await missingRequirements(manifest, folder))
        problems.push(`${entry.name}: missing requirement ${missing}`);
      for (const file of entry.files) {
        checkSetupPath(project, file);
        if (!existsSync(join(project, file)))
          problems.push(`${entry.name}: missing resource ${file}`);
      }
    } catch (error) {
      problems.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return problems;
}

/** Dispatch additions never alter the developer's role map or the manifest on disk. */
export function withPluginDispatch(project: string, manifest: Manifest | null): Manifest | null {
  if (!manifest) return null;
  const entries = readPlugins(project).plugins.filter((entry) => entry.enabled);
  return {
    ...manifest,
    allowed_skills: [...(manifest.allowed_skills ?? []), ...entries.flatMap((p) => p.skills)],
    allowed_agents: [...(manifest.allowed_agents ?? []), ...entries.flatMap((p) => p.agents)],
  };
}
