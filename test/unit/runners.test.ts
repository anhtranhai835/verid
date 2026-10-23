import { describe, expect, it } from "vitest";
import {
  detectRunners,
  goneRunners,
  runnerLabel,
  type FolderFacts,
} from "../../src/core/runners.js";

const folder = (files: string[], more: Partial<FolderFacts> = {}): FolderFacts => ({
  dir: ".",
  files,
  deps: [],
  texts: {},
  ...more,
});
const found = (folders: FolderFacts[], windows = true) =>
  detectRunners(folders, windows).runners.map((r) => `${r.name}@${r.dir}: ${r.command}`);

describe("detectRunners", () => {
  it("names the runner of each build file, with a command that writes a JUnit report", () => {
    const rows: [string, FolderFacts, boolean, string[]][] = [
      [
        "vitest in package.json",
        folder(["package.json"], { deps: ["vitest", "react"] }),
        true,
        ["vitest@.: npx --no vitest run --reporter=junit --outputFile={junit}"],
      ],
      [
        "jest, without vitest",
        folder(["package.json"], { deps: ["jest"] }),
        true,
        ["jest@.: npx --no jest --ci --reporters=default --reporters=jest-junit"],
      ],
      [
        "vitest wins over jest",
        folder(["package.json"], { deps: ["jest", "vitest"] }),
        true,
        ["vitest@.: npx --no vitest run --reporter=junit --outputFile={junit}"],
      ],
      [
        "Playwright beside vitest",
        folder(["package.json", "playwright.config.ts"], { deps: ["vitest"] }),
        true,
        [
          "vitest@.: npx --no vitest run --reporter=junit --outputFile={junit}",
          "playwright@.: npx --no playwright test --reporter=junit",
        ],
      ],
      [
        "@playwright/test in package.json",
        folder(["package.json"], { deps: ["@playwright/test"] }),
        true,
        ["playwright@.: npx --no playwright test --reporter=junit"],
      ],
      [
        "pytest.ini",
        folder(["pytest.ini"]),
        true,
        ["pytest@.: python -m pytest --junitxml={junit}"],
      ],
      [
        "conftest.py",
        folder(["conftest.py"]),
        true,
        ["pytest@.: python -m pytest --junitxml={junit}"],
      ],
      [
        "pytest in pyproject.toml",
        folder(["pyproject.toml"], { texts: { "pyproject.toml": "[tool.pytest.ini_options]" } }),
        true,
        ["pytest@.: python -m pytest --junitxml={junit}"],
      ],
      [
        "pytest in setup.cfg",
        folder(["setup.cfg"], { texts: { "setup.cfg": "[tool:pytest]\n" } }),
        true,
        ["pytest@.: python -m pytest --junitxml={junit}"],
      ],
      [
        "a pyproject.toml without pytest",
        folder(["pyproject.toml"], { texts: { "pyproject.toml": "[project]" } }),
        true,
        [],
      ],
      ["pom.xml", folder(["pom.xml"]), true, ["maven@.: mvn -B -ntp test"]],
      [
        "build.gradle, no wrapper",
        folder(["build.gradle"]),
        true,
        ["gradle@.: gradle test --rerun"],
      ],
      [
        "build.gradle.kts with the wrapper, on Windows",
        folder(["build.gradle.kts", "gradlew", "gradlew.bat"]),
        true,
        ["gradle@.: gradlew.bat test --rerun"],
      ],
      [
        "build.gradle with the wrapper, elsewhere",
        folder(["build.gradle", "gradlew"]),
        false,
        ["gradle@.: ./gradlew test --rerun"],
      ],
      [
        "a solution",
        folder(["App.sln"]),
        true,
        [
          'dotnet@.: dotnet test --logger "junit;LogFileName={assembly}.xml" --results-directory {junit}',
        ],
      ],
      [
        "a C# project",
        folder(["App.csproj"]),
        true,
        [
          'dotnet@.: dotnet test --logger "junit;LogFileName={assembly}.xml" --results-directory {junit}',
        ],
      ],
      ["go.mod", folder(["go.mod"]), true, ["go@.: gotestsum --junitfile {junit} ./..."]],
      [
        "phpunit.xml.dist",
        folder(["phpunit.xml.dist"]),
        true,
        ["phpunit@.: php vendor/bin/phpunit --log-junit {junit}"],
      ],
      [
        "phpunit in composer.json",
        folder(["composer.json"], {
          texts: { "composer.json": '{"require-dev":{"phpunit/phpunit":"^11"}}' },
        }),
        true,
        ["phpunit@.: php vendor/bin/phpunit --log-junit {junit}"],
      ],
      [
        "rspec in the Gemfile",
        folder(["Gemfile"], { texts: { Gemfile: 'gem "rspec"' } }),
        true,
        ["rspec@.: bundle exec rspec --format progress --format RspecJunitFormatter --out {junit}"],
      ],
      [
        "a .rspec file",
        folder([".rspec"]),
        true,
        ["rspec@.: bundle exec rspec --format progress --format RspecJunitFormatter --out {junit}"],
      ],
      [
        "Maven and vitest side by side",
        folder(["pom.xml", "package.json"], { deps: ["vitest"] }),
        true,
        [
          "vitest@.: npx --no vitest run --reporter=junit --outputFile={junit}",
          "maven@.: mvn -B -ntp test",
        ],
      ],
      ["nothing to go by", folder(["README.md", "main.c"]), true, []],
    ];
    const got = rows.map(([name, facts, windows]) => [name, found([facts], windows)]);
    expect(got).toEqual(rows.map(([name, , , want]) => [name, want]));
  });

  it("looks in top-level folders for runners the repo root does not have", () => {
    const rows: [string, FolderFacts[], string[]][] = [
      [
        "pytest at the root, vitest in fe/",
        [
          folder(["pyproject.toml"], { texts: { "pyproject.toml": "pytest" } }),
          folder(["package.json"], { dir: "fe", deps: ["vitest"] }),
        ],
        ["pytest@.", "vitest@fe"],
      ],
      [
        "vitest at the root runs fe/ too",
        [
          folder(["package.json"], { deps: ["vitest"] }),
          folder(["package.json"], { dir: "fe", deps: ["vitest"] }),
        ],
        ["vitest@."],
      ],
      [
        "Maven modules under a root pom",
        [folder(["pom.xml"]), folder(["pom.xml"], { dir: "core" })],
        ["maven@."],
      ],
      ["an empty root, Go in api/", [folder([]), folder(["go.mod"], { dir: "api" })], ["go@api"]],
    ];
    const got = rows.map(([name, folders]) => [
      name,
      detectRunners(folders, true).runners.map((r) => `${r.name}@${r.dir}`),
    ]);
    expect(got).toEqual(rows.map(([name, , want]) => [name, want]));
  });

  it("names the build files of the runners it cannot run", () => {
    const { runners, unsupported } = detectRunners(
      [folder(["Cargo.toml"]), folder(["CMakeLists.txt"], { dir: "native" })],
      true,
    );
    expect({ runners, unsupported }).toEqual({
      runners: [],
      unsupported: ["Cargo.toml", "native/CMakeLists.txt"],
    });
  });

  it("reads Maven and Gradle reports from their own folders, and the report path from jest's environment", () => {
    const one = (facts: FolderFacts) => {
      const [r] = detectRunners([facts], true).runners;
      return r && { env: r.env, reportDirs: r.reportDirs, junitIsFolder: r.junitIsFolder };
    };
    expect({
      maven: one(folder(["pom.xml"])),
      gradle: one(folder(["build.gradle"])),
      jest: one(folder(["package.json"], { deps: ["jest"] })),
      dotnet: one(folder(["App.sln"])),
      vitest: one(folder(["package.json"], { deps: ["vitest"] })),
    }).toEqual({
      maven: {
        env: {},
        reportDirs: ["target/surefire-reports", "*/target/surefire-reports"],
        junitIsFolder: false,
      },
      gradle: {
        env: {},
        reportDirs: ["build/test-results/test", "*/build/test-results/test"],
        junitIsFolder: false,
      },
      jest: {
        env: { JEST_JUNIT_OUTPUT_FILE: "{junit}", JEST_JUNIT_REPORT_TEST_SUITE_ERRORS: "true" },
        reportDirs: [],
        junitIsFolder: false,
      },
      dotnet: { env: {}, reportDirs: [], junitIsFolder: true },
      vitest: { env: {}, reportDirs: [], junitIsFolder: false },
    });
  });
});

describe("goneRunners", () => {
  it("names the runners seen before whose build file is gone", () => {
    const rows: [string[], string[], string[]][] = [
      [["maven@.", "vitest@fe"], ["maven@.", "vitest@fe"], []],
      [["maven@.", "vitest@fe"], ["vitest@fe"], ["maven@."]],
      [[], ["vitest@."], []],
      [["pytest@."], [], ["pytest@."]],
    ];
    expect(rows.map(([seen, now]) => goneRunners(seen, now))).toEqual(
      rows.map(([, , gone]) => gone),
    );
  });
});

describe("runnerLabel", () => {
  it("names a remembered runner as verid cook lists them, with its folder when not the root", () => {
    expect(["maven@.", "vitest@fe", "pytest@api-v2"].map(runnerLabel)).toEqual([
      "maven",
      "vitest (fe)",
      "pytest (api-v2)",
    ]);
  });
});
