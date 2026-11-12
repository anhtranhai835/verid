import { writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  defaultRoles,
  DRIVE_ERROR,
  driveNamed,
  manifestUpgrade,
  MODES,
  resourceRoles,
  ROLE_NAMES,
  parseManifest,
  providerRoles,
  renderManifest,
  suggestManifest,
  suggestMode,
  TEST_GLOBS,
  type InitFlags,
  type Repo,
  type ProjectFacts,
  type Roles,
  type Layout,
  type Manifest,
  type Provider,
} from "../../core/manifest.js";
import { bilingual } from "../../adapters/i18n.js";
import {
  isDirectory,
  manifestFile,
  missingManifestDefaults,
  upgradeManifestText,
} from "../../adapters/manifest.js";
import { detectLayout } from "../../adapters/workspace.js";
import { VeridError } from "../../adapters/state-store.js";
import { ARCHITECTURES } from "../../core/rules.js";
import { invalid, type Planner, readText } from "./planner.js";

/** Where cook puts the new system in a reheat project; the developer may edit the manifest. */
const NEW_SYSTEM = "app";

/** The new system's folder: inside the project, and apart from the legacy folder it rewrites. */
function newSystemFolder(target: string, legacy: string): string {
  const clean = (path: string) =>
    path.replaceAll("\\", "/").replace(/\/+$/, "").replace(/^\.\//, "");
  const folder = clean(target);
  // Compared case-blind: Windows and macOS folders are.
  const [low, old] = [folder.toLowerCase(), clean(legacy).toLowerCase()];
  if (
    !folder ||
    folder === "." ||
    isAbsolute(target) ||
    /^[a-zA-Z]:/.test(folder) ||
    folder.split("/").includes("..") ||
    low === old ||
    low.startsWith(`${old}/`) ||
    old.startsWith(`${low}/`)
  )
    throw invalid(
      "--target",
      `${target} must be a new folder inside the project, apart from ${legacy}`,
    );
  return folder;
}

/** A manifest that is there: kept, or upgraded when the developer asked for that. */
export async function planExistingManifest(
  p: Planner,
  flags: InitFlags,
  existing: Manifest,
  providers: Provider[],
): Promise<{ effective: Manifest; roles: Roles | null | undefined }> {
  const { project, notes, step } = p;
  const flagsGiven =
    flags.mode !== undefined ||
    flags.workflow !== undefined ||
    flags.resources !== undefined ||
    flags.drive !== undefined ||
    flags.architecture !== undefined ||
    flags.layout !== undefined ||
    flags.legacy !== undefined ||
    flags.target !== undefined ||
    flags.providers !== undefined ||
    flags.iterations !== undefined ||
    flags.duration !== undefined ||
    flags.startDate !== undefined ||
    flags.demoDay !== undefined ||
    flags.testCmd !== undefined ||
    flags.src.length > 0 ||
    flags.tests.length > 0;
  let roles: Roles | null | undefined;
  const upgrades = existing.repos.map((repo) =>
    manifestUpgrade(repo, existing.roles, providers, existing.resources),
  );
  const upgrade = upgrades[0];
  roles =
    flags.upgrade && upgrade?.roles ? { ...existing.roles, ...upgrade.roles } : existing.roles;
  if (flags.upgrade) roles = providerRoles(roles ?? undefined, providers);
  const missingDefaults = await missingManifestDefaults(readText(manifestFile(project)) ?? "");
  const items = manifestUpgradeLines(existing, missingDefaults);
  if (upgrade && (items.length > 0 || existing.workflow !== undefined) && flags.upgrade) {
    // Edited on what is there now, checked before anything is written.
    let text = readText(manifestFile(project)) ?? "";
    for (const [i, up] of upgrades.entries()) text = await upgradeManifestText(text, up, i);
    step("updated", ".verid/manifest.yaml", {
      content: text,
      apply: () => writeFileSync(manifestFile(project), text),
    });
  } else step("kept", ".verid/manifest.yaml");
  // Without a terminal to ask in, the developer hears what a cook in their terminal would add.
  if (items.length > 0 && flags.upgrade === undefined)
    notes.push(bilingual("init.upgrade", {}), ...items);
  if (flagsGiven) notes.push(bilingual("init.flags_ignored", {}));
  const effective: Manifest = {
    ...existing,
    ...(flags.upgrade && missingDefaults.includes("allowed_agents") && { allowed_agents: [] }),
    ...(roles && { roles }),
  };
  return { effective, roles };
}

/** A new manifest, from the flags and what the folder suggests; checked before it is planned. */
export function planNewManifest(
  p: Planner,
  flags: InitFlags,
  layout: Layout,
  detected: ReturnType<typeof detectLayout> | null,
  providers: Provider[],
): { effective: Manifest; roles: Roles; repo: Repo | undefined; reheatRepos: Repo[] | undefined } {
  const { project, notes, step } = p;
  let repo: Repo | undefined;
  let reheatRepos: Repo[] | undefined;
  // A new manifest needs the developer's choice of mode: the folder only suggests one.
  const facts = projectFacts(
    project,
    layout === "workspace" ? detected?.repos.map((repo) => repo.path) : undefined,
  );
  if (flags.mode === undefined && !flags.yes && !flags.dryRun)
    throw new VeridError("VERID_BURNT_INIT_NO_MODE", { suggested: suggestMode(facts) });
  const mode = MODES.find((m) => m === (flags.mode ?? suggestMode(facts)));
  if (!mode) throw invalid("--mode", "must be prep, recipe, remix or reheat");
  const drive = flags.drive === undefined ? undefined : driveNamed(flags.drive);
  if (flags.drive !== undefined && !drive) throw invalid("--drive", DRIVE_ERROR);
  if (
    !flags.iterations &&
    [flags.duration, flags.startDate, flags.demoDay].some((v) => v !== undefined)
  )
    throw invalid("--iterations", "required with --duration, --start-date or --demo-day");

  if (
    flags.architecture !== undefined &&
    !ARCHITECTURES.includes(flags.architecture as (typeof ARCHITECTURES)[number])
  )
    throw invalid("--architecture", "must be ddd, clean, layered or none");
  const suggested = suggestManifest(flags);
  if (flags.target !== undefined && mode !== "reheat")
    throw invalid("--target", "only with --mode reheat: the folder for the new system");
  // Reheat: the new system goes in a folder of its own, beside the legacy one, which is only read.
  if (mode === "reheat") {
    if (layout === "workspace") throw invalid("--mode", "reheat needs the monorepo layout");
    if (flags.legacy === undefined)
      throw invalid("--legacy", "needed with --mode reheat: the folder of the legacy system");
    if (!isDirectory(resolve(project, ...flags.legacy.split(/[/\\]/))))
      throw invalid("--legacy", `${flags.legacy} is not a folder of this project`);
    const target = newSystemFolder(flags.target ?? NEW_SYSTEM, flags.legacy);
    reheatRepos = [
      { ...suggested, path: target },
      {
        path: flags.legacy,
        role: "legacy",
        read_only: true,
        source_globs: ["**"],
        test_globs: [...TEST_GLOBS],
      },
    ];
  }
  const repos =
    reheatRepos ??
    (layout === "workspace"
      ? (detected?.repos ?? []).map((repo) => ({ ...suggested, ...repo }))
      : [suggested]);
  const selectedRoles = resourceRoles(defaultRoles(providers), flags.resources);
  const checked = parseManifest({
    schemaVersion: 1,
    mode,
    architecture: flags.architecture ?? "ddd",
    roles: selectedRoles,
    resources: flags.resources,
    drive,
    layout,
    providers,
    allowed_agents: [],
    ...(flags.iterations && {
      iterations: {
        duration: flags.duration,
        start_date: flags.startDate,
        demo_day: flags.demoDay,
      },
    }),
    repos,
  });
  if (!checked.ok) {
    const repoField = /^repos\.(\d+)\.(path|remote|default_branch):/.exec(checked.detail);
    const iterationField = /^iterations(?:\.(\w+))?:/.exec(checked.detail);
    const iterationFlag = {
      duration: "--duration",
      start_date: "--start-date",
      demo_day: "--demo-day",
    };
    throw invalid(
      repoField
        ? resolve(project, repos[Number(repoField[1])]?.path ?? ".")
        : iterationField
          ? (iterationFlag[iterationField[1] as keyof typeof iterationFlag] ?? "--iterations")
          : checked.detail.startsWith("drive:")
            ? "--drive"
            : "--test-cmd/--src/--tests",
      checked.detail,
    );
  }
  const text = renderManifest(
    mode,
    repos,
    selectedRoles,
    drive,
    layout,
    checked.manifest.iterations,
    providers,
    checked.manifest.architecture,
    { resources: checked.manifest.resources },
  );
  const effective = checked.manifest;
  if (checked.manifest.iterations) {
    const { duration, start_date, demo_day } = checked.manifest.iterations;
    notes.push(
      `iterations:\n  duration: ${JSON.stringify(duration)}\n  start_date: ${JSON.stringify(start_date)}\n  demo_day: ${JSON.stringify(demo_day)}`,
    );
  }
  const roles = selectedRoles;
  if (layout === "monorepo") repo = reheatRepos?.[0] ?? suggested;
  if (reheatRepos?.[1])
    notes.push(
      bilingual("cook.legacy_note", {
        legacy: reheatRepos[1].path,
        target: reheatRepos[0]!.path,
      }),
    );
  step("created", ".verid/manifest.yaml", {
    content: text,
    apply: () => writeFileSync(manifestFile(project), text, { flag: "wx" }),
  });
  return { effective, roles, repo, reheatRepos };
}

export function projectFacts(project: string, repos: readonly string[] = ["."]): ProjectFacts {
  return {
    sourceDir: repos
      .flatMap((repo) => ["src", "lib", "app"].map((dir) => join(repo, dir)))
      .find((dir) => isDirectory(join(project, dir))),
  };
}

/** What manifestUpgrade() would change, a line per key: `+` adds globs or roles. */
export function manifestUpgradeLines(
  manifest: Pick<Manifest, "repos" | "roles"> &
    Partial<Pick<Manifest, "providers" | "resources" | "workflow">>,
  missing: readonly string[] = [],
): string[] {
  return [
    ...(manifest.workflow !== undefined
      ? [`  - workflow: ${manifest.workflow} (retired; run verid upgrade)`]
      : []),
    ...(manifest.providers?.includes("codex") &&
    !manifest.roles?.reviewer?.includes("verid_reviewer")
      ? ['  + roles.reviewer: "verid_reviewer"']
      : []),
    ...missing.map((key) => `  + ${key}: ${key === "providers" ? '["claude-code"]' : "[]"}`),
    ...manifest.repos.flatMap((repo, i) =>
      upgradeLines({
        ...manifestUpgrade(repo, manifest.roles, manifest.providers, manifest.resources),
        ...(i > 0 && { roles: null }),
      }).map((line) =>
        manifest.repos.length > 1 && !line.trimStart().startsWith("+ roles.")
          ? `${repo.path}: ${line}`
          : line,
      ),
    ),
  ];
}

function upgradeLines(up: ReturnType<typeof manifestUpgrade>): string[] {
  const globs = (list: string[]) => list.map((g) => JSON.stringify(g)).join(", ");
  return [
    ...(up.tests.length > 0 ? [`  + test_globs: ${globs(up.tests)}`] : []),
    ...(up.ignore.length > 0 ? [`  + ignore_globs: ${globs(up.ignore)}`] : []),
    ...(up.e2e.length > 0 ? [`  + e2e_globs: ${globs(up.e2e)}`] : []),
    ...ROLE_NAMES.flatMap((r) =>
      up.roles?.[r] ? [`  + roles.${r}: ${JSON.stringify(up.roles[r])}`] : [],
    ),
  ];
}
