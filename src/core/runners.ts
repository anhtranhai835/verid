/** What a folder of the repo holds that names its test runner. */
export interface FolderFacts {
  /** "." for the repo root, or the name of a top-level folder. */
  dir: string;
  /** The names of the files in it. */
  files: readonly string[];
  /** The dependencies and devDependencies of its package.json. */
  deps: readonly string[];
  /** The text of pyproject.toml, setup.cfg, Gemfile and composer.json, when there. */
  texts: Readonly<Record<string, string>>;
}

export type RunnerName =
  | "vitest"
  | "jest"
  | "playwright"
  | "pytest"
  | "maven"
  | "gradle"
  | "dotnet"
  | "go"
  | "phpunit"
  | "rspec";

/** A test runner verid runs by itself when the manifest has no test_cmd. */
export interface Runner {
  name: RunnerName;
  dir: string;
  /** Run in `dir`; {junit} becomes the quoted path of the report in verid's run folder. */
  command: string;
  /** Set for the command; {junit} becomes the path, unquoted. */
  env: Record<string, string>;
  /**
   * {junit} is a folder the runner writes its reports into, not a file.
   */
  junitIsFolder: boolean;
  /**
   * Maven and Gradle write reports only into their own folders: the TEST-*.xml there count,
   * after verid removed the old ones. Relative to `dir`; `*` stands for each module folder.
   */
  reportDirs: string[];
  /** What to install when the run leaves no report, for the agent to run. */
  setup: string | null;
}

const NONE = { env: {}, junitIsFolder: false, reportDirs: [], setup: null };

const mentions = (f: FolderFacts, file: string, word: RegExp) => word.test(f.texts[file] ?? "");
const has = (f: FolderFacts, name: string) => f.files.includes(name);
const hasExt = (f: FolderFacts, ...exts: string[]) =>
  f.files.some((n) => exts.some((e) => n.toLowerCase().endsWith(e)));

/**
 * The runners of one folder, in a fixed order. Each command writes a JUnit report to a path
 * verid picks, except Maven and Gradle, which have no flag for it.
 */
function runnersOf(f: FolderFacts, windows: boolean): Omit<Runner, "dir">[] {
  const out: Omit<Runner, "dir">[] = [];
  if (f.deps.includes("vitest"))
    out.push({
      ...NONE,
      name: "vitest",
      command: "npx --no vitest run --reporter=junit --outputFile={junit}",
      setup: "npm install",
    });
  else if (f.deps.includes("jest"))
    out.push({
      ...NONE,
      name: "jest",
      command: "npx --no jest --ci --reporters=default --reporters=jest-junit",
      // Without it, a test file that cannot load is missing from jest-junit's report.
      env: { JEST_JUNIT_OUTPUT_FILE: "{junit}", JEST_JUNIT_REPORT_TEST_SUITE_ERRORS: "true" },
      setup: "npm install -D jest-junit",
    });
  // Next to the unit tests, not instead: everything it reports counts as end-to-end.
  if (
    ["ts", "js", "mjs", "cjs"].some((ext) => has(f, `playwright.config.${ext}`)) ||
    f.deps.includes("@playwright/test")
  )
    out.push({
      ...NONE,
      name: "playwright",
      command: "npx --no playwright test --reporter=junit",
      env: { PLAYWRIGHT_JUNIT_OUTPUT_NAME: "{junit}" },
      setup: "npm install -D @playwright/test && npx playwright install",
    });
  if (
    has(f, "pytest.ini") ||
    has(f, "conftest.py") ||
    mentions(f, "pyproject.toml", /pytest/) ||
    mentions(f, "setup.cfg", /\[tool:pytest\]/)
  )
    out.push({
      ...NONE,
      name: "pytest",
      command: "python -m pytest --junitxml={junit}",
      setup: "python -m pip install pytest",
    });
  if (has(f, "pom.xml"))
    out.push({
      ...NONE,
      name: "maven",
      command: "mvn -B -ntp test",
      reportDirs: ["target/surefire-reports", "*/target/surefire-reports"],
    });
  if (has(f, "build.gradle") || has(f, "build.gradle.kts")) {
    const wrapper = windows
      ? has(f, "gradlew.bat") && "gradlew.bat"
      : has(f, "gradlew") && "./gradlew";
    out.push({
      ...NONE,
      name: "gradle",
      // --rerun: a test task Gradle finds up to date writes no new report.
      command: `${wrapper || "gradle"} test --rerun`,
      reportDirs: ["build/test-results/test", "*/build/test-results/test"],
    });
  }
  if (hasExt(f, ".sln", ".slnx", ".csproj", ".fsproj", ".vbproj"))
    out.push({
      ...NONE,
      name: "dotnet",
      // One report per test project, named after it, in the folder verid reads.
      command:
        'dotnet test --logger "junit;LogFileName={assembly}.xml" --results-directory {junit}',
      junitIsFolder: true,
      setup: "dotnet add <test project> package JunitXml.TestLogger",
    });
  if (has(f, "go.mod"))
    out.push({
      ...NONE,
      name: "go",
      command: "gotestsum --junitfile {junit} ./...",
      setup: "go install gotest.tools/gotestsum@latest",
    });
  if (
    has(f, "phpunit.xml") ||
    has(f, "phpunit.xml.dist") ||
    mentions(f, "composer.json", /phpunit/)
  )
    out.push({
      ...NONE,
      name: "phpunit",
      command: "php vendor/bin/phpunit --log-junit {junit}",
      setup: "composer require --dev phpunit/phpunit",
    });
  if (has(f, ".rspec") || mentions(f, "Gemfile", /rspec/))
    out.push({
      ...NONE,
      name: "rspec",
      command: "bundle exec rspec --format progress --format RspecJunitFormatter --out {junit}",
      setup: "bundle add rspec_junit_formatter --group test",
    });
  return out;
}

/** Build files of runners that cannot be told where to write a report. */
const UNSUPPORTED = ["Cargo.toml", "CMakeLists.txt"];

/**
 * The runners of the repo root, then those of its top-level folders that the root does not
 * have: a root vitest already runs fe/'s tests, a root pom.xml its modules.
 */
export function detectRunners(
  folders: readonly FolderFacts[],
  windows: boolean,
): { runners: Runner[]; unsupported: string[] } {
  const runners: Runner[] = [];
  for (const f of folders)
    for (const r of runnersOf(f, windows))
      if (!runners.some((x) => x.name === r.name)) runners.push({ ...r, dir: f.dir });
  const unsupported = folders.flatMap((f) =>
    UNSUPPORTED.filter((n) => has(f, n)).map((n) => (f.dir === "." ? n : `${f.dir}/${n}`)),
  );
  return { runners, unsupported };
}

/** How state remembers a runner: `maven@.`, `vitest@fe`. */
export const runnerKey = (r: Pick<Runner, "name" | "dir">) => `${r.name}@${r.dir}`;

/** A remembered runner as the developer reads it, like verid cook lists them: `vitest (fe)`. */
export function runnerLabel(key: string): string {
  const at = key.indexOf("@");
  const dir = key.slice(at + 1);
  return dir === "." ? key.slice(0, at) : `${key.slice(0, at)} (${dir})`;
}

/**
 * The runners seen before whose build file is gone. Deleting pom.xml would otherwise leave the
 * Java tests out of every later run, failing ones included.
 */
export const goneRunners = (seen: readonly string[], now: readonly string[]): string[] =>
  seen.filter((k) => !now.includes(k));
