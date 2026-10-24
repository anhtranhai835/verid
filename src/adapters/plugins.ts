import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import * as z from "zod/mini";
import {
  parsePluginList,
  parsePluginManifest,
  parsePluginSource,
  type PluginEntry,
  type PluginEvent,
  type PluginManifest,
} from "../core/plugins.js";
import { appendAudit } from "./audit-log.js";
import { bilingual } from "./i18n.js";
import { errno, statePaths, VeridError, withLock } from "./state-store.js";
import { ask, type Io } from "./terminal.js";
import { killTree } from "./test-runner.js";
import { checkSetupPath, sharedRemote, workspaceGit } from "./workspace.js";

const invalid = (path: string, detail: string) =>
  new VeridError("VERID_BURNT_PLUGIN_INVALID", { path, detail });

/** Reject links in every existing component, including the manifest and data directories. */
export function pluginPath(project: string, path: string): string {
  try {
    checkSetupPath(project, `.verid/${path}`);
  } catch (error) {
    if (error instanceof VeridError) throw invalid(path, "must stay inside .verid without links");
    throw error;
  }
  return join(project, ".verid", path);
}

export function readPlugins(project: string): PluginEntry[] {
  const file = pluginPath(project, "plugins.json");
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (errno(error) === "ENOENT") return [];
    if (error instanceof SyntaxError) throw invalid(file, "invalid JSON");
    throw error;
  }
  const result = parsePluginList(input);
  if (!result.ok) throw invalid(file, result.detail);
  return result.plugins;
}

function writePlugins(project: string, entries: PluginEntry[]): void {
  const file = pluginPath(project, "plugins.json");
  const temporary = pluginPath(project, ".state/plugins.json.tmp");
  writeFileSync(temporary, `${JSON.stringify(entries, null, 2)}\n`);
  renameSync(temporary, file);
}

const sha256 = z.string().check(z.regex(/^[a-f0-9]{64}$/));
const approvalsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  manifest_sha256: sha256,
  plugins: z.record(
    z.string(),
    z.strictObject({
      entry: z.strictObject({ name: z.string(), source: z.string(), resolved: z.string() }),
      sha256,
    }),
  ),
});
type PluginApprovals = z.infer<typeof approvalsSchema>;
const APPROVALS = ".state/plugin-integrity.json";

function readPluginApprovals(project: string): PluginApprovals | null {
  try {
    const parsed = approvalsSchema.safeParse(
      JSON.parse(readFileSync(pluginPath(project, APPROVALS), "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (errno(error) === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function pluginRegistryHash(project: string): string | null {
  try {
    return createHash("sha256")
      .update(readFileSync(pluginPath(project, "plugins.json")))
      .digest("hex");
  } catch (error) {
    if (errno(error) === "ENOENT") return null;
    throw error;
  }
}

/** All relative file paths and bytes, in stable order, including helpers and dependencies. */
function pluginTreeHash(project: string, name: string): string {
  const folder = pluginPath(project, `plugins/${name}`);
  if (!lstatSync(folder).isDirectory()) throw invalid(folder, "plugin must be a directory");
  const files: string[] = [];
  const visit = (path: string) => {
    for (const entry of readdirSync(join(folder, path))) {
      const child = path ? `${path}/${entry}` : entry;
      const stat = lstatSync(join(folder, child));
      if (stat.isSymbolicLink()) throw invalid(child, "plugin files must not be links");
      if (stat.isDirectory()) visit(child);
      else if (stat.isFile()) files.push(child);
      else throw invalid(child, "plugin files must be regular files");
    }
  };
  visit("");
  const hash = createHash("sha256");
  for (const path of files.sort()) {
    const bytes = readFileSync(join(folder, path));
    // Length-delimited paths and contents cannot collide through concatenation boundaries.
    hash
      .update(JSON.stringify([path, bytes.length]))
      .update("\0")
      .update(bytes);
  }
  return hash.digest("hex");
}

const sameEntry = (a: PluginEntry, b: PluginEntry) =>
  a.name === b.name && a.source === b.source && a.resolved === b.resolved;
const integrityError = (name: string, detail: string) =>
  new VeridError("VERID_BURNT_PLUGIN_INTEGRITY", { name, detail });

/** No command that observes or runs a plugin can create or refresh an approval. */
export function checkPluginIntegrity(project: string, entry?: PluginEntry): void {
  const name = entry?.name ?? "plugins.json";
  try {
    const registry = pluginRegistryHash(project);
    const approved = readPluginApprovals(project);
    if (!entry && registry === null && approved === null) return;
    if (!approved) throw integrityError(name, "approval record is missing or invalid");
    if (registry !== approved.manifest_sha256)
      throw integrityError(name, "plugins.json sha256 mismatch");
    if (!entry) return;
    const plugin = approved.plugins[entry.name];
    if (!plugin || !sameEntry(plugin.entry, entry))
      throw integrityError(name, "plugin approval is missing");
    if (pluginTreeHash(project, entry.name) !== plugin.sha256)
      throw integrityError(name, "plugin files sha256 mismatch");
  } catch (error) {
    if (error instanceof VeridError && error.code === "VERID_BURNT_PLUGIN_INTEGRITY") throw error;
    throw integrityError(name, pluginError(error));
  }
}

export function pluginNeedsRestore(project: string, entry: PluginEntry): boolean {
  try {
    checkPluginIntegrity(project, entry);
    return false;
  } catch {
    return true;
  }
}

/** Under the state lock, approve only the installed/restored target and retain other approvals. */
function approvePlugins(project: string, entries: PluginEntry[], name?: string): void {
  const before = readPluginApprovals(project);
  const plugins: PluginApprovals["plugins"] = {};
  for (const entry of entries) {
    const prior = before?.plugins[entry.name];
    if (entry.name === name)
      plugins[entry.name] = { entry, sha256: pluginTreeHash(project, entry.name) };
    else if (prior && sameEntry(prior.entry, entry)) plugins[entry.name] = prior;
  }
  const record: PluginApprovals = {
    schemaVersion: 1,
    manifest_sha256: pluginRegistryHash(project)!,
    plugins,
  };
  const file = pluginPath(project, APPROVALS);
  const temporary = pluginPath(project, `${APPROVALS}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`);
  try {
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function installedManifest(project: string, entry: PluginEntry): PluginManifest {
  const folder = pluginPath(project, `plugins/${entry.name}`);
  const manifest = readPluginManifest(folder);
  const source = parsePluginSource(entry.source);
  if (
    manifest.name !== entry.name ||
    (source.ok && source.source.kind !== "git" && manifest.version !== entry.resolved)
  )
    throw invalid(folder, "name or version differs from plugins.json");
  return manifest;
}

function readPluginManifest(folder: string): PluginManifest {
  const file = join(folder, "verid-plugin.json");
  try {
    checkSetupPath(folder, "verid-plugin.json");
    const result = parsePluginManifest(JSON.parse(readFileSync(file, "utf8")));
    if (!result.ok) throw invalid(file, result.detail);
    for (const script of Object.values(result.manifest.events)) checkedScript(folder, script);
    return result.manifest;
  } catch (error) {
    if (error instanceof VeridError && error.code === "VERID_BURNT_PLUGIN_INVALID") throw error;
    if (error instanceof SyntaxError || error instanceof VeridError || errno(error) === "ENOENT")
      throw invalid(file, "manifest and event scripts must exist inside the plugin without links");
    throw error;
  }
}

function checkedScript(folder: string, script: string): string {
  checkSetupPath(folder, script);
  const file = resolve(folder, ...script.split(/[/\\]/));
  if (!lstatSync(file).isFile()) throw invalid(script, "event script must be a file");
  return file;
}

/** Check PATH without executing an untrusted command or its --version behaviour. */
function findCommand(command: string): string | null {
  const extensions =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  for (const folder of (process.env.PATH ?? "").split(delimiter).filter(Boolean))
    for (const extension of ["", ...extensions]) {
      const file = join(folder.replace(/^"|"$/g, ""), `${command}${extension}`);
      try {
        if (!lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink()) continue;
        accessSync(file, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return file;
      } catch {
        /* Try the next PATH entry. */
      }
    }
  return null;
}

export function checkPluginTools(manifest: PluginManifest): void {
  const missing = manifest.requires.filter((tool) => findCommand(tool) === null);
  if (missing.length)
    throw new VeridError("VERID_BURNT_PLUGIN_REQUIRES", {
      name: manifest.name,
      tools: missing.join(", "),
    });
}

/** Preserve developer lines; fetched code is the only additional ignored artifact. */
export function pluginIgnore(text: string): string {
  return /^\/?plugins\/\r?$/m.test(text)
    ? text
    : `${text}${text && !text.endsWith("\n") ? "\n" : ""}plugins/\n`;
}

function copyFolder(source: string, destination: string): void {
  if (lstatSync(source).isSymbolicLink()) throw invalid(source, "plugin files must not be links");
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isSymbolicLink()) throw invalid(from, "plugin files must not be links");
    if (entry.isDirectory()) copyFolder(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
    else throw invalid(from, "plugin files must be regular files");
  }
}

function npmCli(): string {
  const npm = findCommand("npm");
  const candidates = [join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")];
  if (npm) {
    const real = realpathSync(npm);
    if (/\.js$/i.test(real)) candidates.unshift(real);
    candidates.push(join(dirname(npm), "node_modules/npm/bin/npm-cli.js"));
  }
  const found = candidates.find((file) => existsSync(file));
  if (!found)
    throw new VeridError("VERID_BURNT_PLUGIN_REQUIRES", { name: "npm source", tools: "npm" });
  return found;
}

export interface PluginInstallOptions {
  yes?: boolean | undefined;
  io?: Io | undefined;
  expected?: PluginEntry;
}

/** Fetch without running plugin code, inspect, confirm, then publish a copy and register it. */
export async function installPlugin(
  project: string,
  sourceText: string,
  options: PluginInstallOptions,
): Promise<PluginManifest> {
  const parsed = parsePluginSource(sourceText);
  if (!parsed.ok) throw new VeridError(parsed.code, { detail: parsed.detail });
  if (!options.yes && !options.io) throw new VeridError("VERID_BURNT_PLUGIN_CONFIRM");
  const source = parsed.source;
  const staging = pluginPath(project, "plugins");
  mkdirSync(staging, { recursive: true });
  const work = mkdtempSync(join(staging, ".fetch-"));
  const prepared = join(work, "prepared");
  let resolved: string;
  let recorded = sourceText;
  try {
    let folder: string;
    if (source.kind === "file") {
      folder = resolve(project, source.path);
      if (!existsSync(folder) || !lstatSync(folder).isDirectory())
        throw invalid(source.path, "local source must be an existing directory");
      const inside = relative(folder, work);
      if (!inside.startsWith("..") && !/^[a-z]:/i.test(inside))
        throw invalid(folder, "source contains the staging directory");
      // The source folder itself must not redirect the copy through a link.
      checkSetupPath(dirname(folder), relative(dirname(folder), folder));
      recorded = `file:${source.path}`;
      copyFolder(folder, prepared);
      folder = prepared;
    } else if (source.kind === "git") {
      folder = join(work, "repo");
      const remote = sharedRemote(source.remote);
      recorded = `git:${remote}${source.ref ? `#${source.ref}` : ""}`;
      const clone = workspaceGit(project, ["clone", "--no-checkout", "--", remote, folder]);
      if (clone.error || clone.status !== 0) throw invalid(recorded, "git clone failed");
      const commit = workspaceGit(folder, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${options.expected?.resolved ?? source.ref ?? "HEAD"}^{commit}`,
      ]);
      resolved = commit.stdout?.trim();
      if (commit.error || commit.status !== 0 || !/^[a-f0-9]{40,64}$/.test(resolved))
        throw invalid(recorded, "git ref is not a commit");
      const checkout = workspaceGit(folder, ["checkout", "--detach", resolved, "--"]);
      if (checkout.error || checkout.status !== 0) throw invalid(recorded, "git checkout failed");
      copyFolder(folder, prepared);
      folder = prepared;
    } else {
      const packageName = /^(?:@[^/]+\/)?[^@]+/.exec(source.spec)![0];
      const spec = options.expected ? `${packageName}@${options.expected.resolved}` : source.spec;
      const result = spawnSync(
        process.execPath,
        [
          npmCli(),
          "install",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--no-bin-links",
          "--package-lock=false",
          "--prefix",
          work,
          "--",
          spec,
        ],
        {
          cwd: work,
          stdio: "inherit",
          windowsHide: true,
          env: { ...process.env, GIT_ALLOW_PROTOCOL: "https:ssh:git:file" },
        },
      );
      if (result.error || result.status !== 0) throw invalid(spec, "npm install failed");
      folder = join(work, "node_modules", packageName);
      const pkg = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as {
        version?: string;
      };
      const manifest = readPluginManifest(folder);
      if (pkg.version !== manifest.version)
        throw invalid(spec, "package and manifest versions differ");
      copyFolder(folder, prepared);
      copyFolder(join(work, "node_modules"), join(prepared, "node_modules"));
      folder = prepared;
      recorded = `npm:${source.spec}`;
    }
    const manifest = readPluginManifest(folder);
    checkPluginTools(manifest);
    resolved = source.kind === "git" ? resolved! : manifest.version;
    if (
      options.expected &&
      (manifest.name !== options.expected.name || resolved !== options.expected.resolved)
    )
      throw invalid(recorded, "restored name or version differs from plugins.json");
    const output = options.io?.output ?? process.stdout;
    output.write(
      `${bilingual("plugin.unofficial", {})}\n${manifest.name} ${manifest.version}\nevents: ${Object.keys(manifest.events).join(", ") || "—"}\nrequires: ${manifest.requires.join(", ") || "—"}\nsource: ${recorded}\n`,
    );
    if (!options.yes) {
      const answer = await ask(options.io!, bilingual("plugin.confirm", {}));
      if (!answer || !/^(y|yes)$/i.test(answer)) throw new VeridError("VERID_BURNT_PLUGIN_CONFIRM");
    }
    const paths = statePaths(project);
    withLock(paths, () => {
      const entries = readPlugins(project);
      const previous = entries.find((e) => e.name === manifest.name);
      const destination = pluginPath(project, `plugins/${manifest.name}`);
      const data = pluginPath(project, `plugin-data/${manifest.name}`);
      if (existsSync(data) && !lstatSync(data).isDirectory())
        throw invalid(data, "plugin data must be a directory");
      if (!options.expected && (existsSync(destination) || previous))
        throw invalid(manifest.name, "already installed; remove it before adding again");
      if (options.expected && JSON.stringify(previous) !== JSON.stringify(options.expected))
        throw invalid(manifest.name, "plugins.json changed during restoration");
      const ignore = pluginPath(project, ".gitignore");
      let before = "";
      try {
        before = readFileSync(ignore, "utf8");
      } catch (error) {
        if (errno(error) !== "ENOENT") throw error;
      }
      writeFileSync(ignore, pluginIgnore(before || ".state/\n"));
      mkdirSync(dirname(destination), { recursive: true });
      mkdirSync(data, { recursive: true });
      // Preserve an existing copy until confirmation and restore it on a publication failure.
      const backup = join(work, "previous");
      if (existsSync(destination)) renameSync(destination, backup);
      try {
        // Staging and destination share a protected folder and a volume.
        renameSync(prepared, destination);
        const next = options.expected
          ? entries
          : [...entries, { name: manifest.name, source: recorded, resolved }];
        if (!options.expected) writePlugins(project, next);
        approvePlugins(project, next, manifest.name);
      } catch (error) {
        rmSync(pluginPath(project, `plugins/${manifest.name}`), { recursive: true, force: true });
        if (existsSync(backup)) renameSync(backup, destination);
        throw error;
      }
    });
    return manifest;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function removePlugin(project: string, name: string): void {
  const paths = statePaths(project);
  withLock(paths, () => {
    const entries = readPlugins(project);
    if (!entries.some((e) => e.name === name)) throw invalid(name, "plugin is not registered");
    const folder = pluginPath(project, `plugins/${name}`);
    const next = entries.filter((e) => e.name !== name);
    writePlugins(project, next);
    rmSync(folder, { recursive: true, force: true });
    approvePlugins(project, next);
  });
}

/** Missing or changed plugins need a fresh, confirmed restore from their recorded source. */
export async function restorePlugins(
  project: string,
  options: PluginInstallOptions,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const entry of readPlugins(project)) {
    if (!pluginNeedsRestore(project, entry)) continue;
    try {
      await installPlugin(project, entry.source, { ...options, expected: entry });
    } catch (error) {
      warnings.push(pluginError(error));
    }
  }
  return warnings;
}

export function pluginError(error: unknown): string {
  const code = error instanceof VeridError ? error.code : "VERID_BURNT_INTERNAL";
  const params =
    error instanceof VeridError
      ? error.params
      : { detail: error instanceof Error ? error.message : String(error) };
  return `verid [${code}]\n${bilingual(code, params)}`;
}

/** Observer only: stdout is discarded, and every error becomes an audited warning. */
export async function emitPluginEvent(
  project: string,
  event: PluginEvent,
  input: Record<string, unknown>,
  deadline = Date.now() + 5000,
): Promise<string[]> {
  const warnings: string[] = [];
  const failed = (name: string, reason: string, detail: string) => {
    warnings.push(pluginEventWarning(project, name, event, reason, detail));
  };
  let entries: PluginEntry[];
  try {
    checkPluginIntegrity(project);
    entries = readPlugins(project);
  } catch (error) {
    failed("plugins.json", "integrity", pluginError(error));
    return warnings;
  }
  for (const entry of entries) {
    try {
      checkPluginIntegrity(project, entry);
      const manifest = installedManifest(project, entry);
      const script = manifest.events[event];
      if (!script) continue;
      const folder = pluginPath(project, `plugins/${entry.name}`);
      const file = checkedScript(folder, script);
      const data = pluginPath(project, `plugin-data/${entry.name}`);
      mkdirSync(data, { recursive: true });
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        failed(entry.name, "timeout", "event time budget exhausted");
        continue;
      }
      const { NODE_OPTIONS: _nodeOptions, NODE_PATH: _nodePath, ...environment } = process.env;
      const failure = await new Promise<{ reason: string; detail: string } | undefined>((done) => {
        const child = spawn(process.execPath, [file], {
          cwd: folder,
          windowsHide: true,
          stdio: ["pipe", "ignore", "ignore"],
          env: { ...environment, VERID_PLUGIN_DATA: data },
          detached: process.platform !== "win32",
        });
        let settled = false;
        const finish = (value?: { reason: string; detail: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.stdin!.destroy();
          done(value);
        };
        const timer = setTimeout(() => {
          killTree(child.pid);
          // Keep the deadline bounded even if tree termination is unavailable.
          child.kill("SIGKILL");
          finish({ reason: "timeout", detail: "event time budget exhausted" });
        }, remaining);
        child.on("error", (error) => finish({ reason: "spawn", detail: error.message }));
        child.on("close", (status, signal) =>
          finish(status === 0 ? undefined : { reason: "exit", detail: `exit ${status ?? signal}` }),
        );
        // A script may close stdin without reading it; its exit still determines failure.
        child.stdin!.on("error", () => {});
        child.stdin!.end(JSON.stringify({ ...input, event }));
      });
      if (failure) failed(entry.name, failure.reason, failure.detail);
    } catch (error) {
      failed(
        entry.name,
        error instanceof VeridError && error.code === "VERID_BURNT_PLUGIN_INTEGRITY"
          ? "integrity"
          : "invalid",
        pluginError(error),
      );
    }
  }
  return warnings;
}

export function pluginEventWarning(
  project: string,
  name: string,
  event: string,
  reason: string,
  detail: string,
): string {
  const paths = statePaths(project);
  let auditError = "";
  try {
    withLock(paths, () =>
      appendAudit(paths.audit, {
        event: "plugin_failed",
        plugin: name,
        plugin_event: event,
        reason,
        detail,
      }),
    );
  } catch (error) {
    auditError = `; audit: ${pluginError(error)}`;
  }
  return `verid [VERID_BURNT_PLUGIN_EVENT]\n${bilingual("VERID_BURNT_PLUGIN_EVENT", { name, event, detail: detail + auditError })}`;
}
