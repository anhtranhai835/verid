import { vi } from "vitest";
import { setLanguage } from "../../src/adapters/i18n.js";
import { tempProject } from "./project.js";
import type { ProjectOptions, TestProject } from "./types.js";
type CookOptions = ProjectOptions & {
  codexHome?: string | false;
  claude?: "inherit" | "clear" | "unset";
  language?: Parameters<typeof setLanguage>[0];
};
/** Cook fixtures restore terminal markers, Codex home and language after every case. */
export function developerProject(prefix: string, options: CookOptions = {}) {
  const { codexHome = "user-codex", claude = "inherit", language, ...projectOptions } = options;
  let agent: string | undefined;
  return tempProject(prefix, {
    ...projectOptions,
    setup: (p) => {
      agent = process.env.CLAUDECODE;
      if (claude === "clear") vi.stubEnv("CLAUDECODE", "");
      if (claude === "unset") delete process.env.CLAUDECODE;
      if (codexHome !== false) vi.stubEnv("CODEX_HOME", p.path(codexHome));
      if (language !== undefined) setLanguage(language);
      projectOptions.setup?.(p);
    },
    teardown: async () => {
      try {
        await projectOptions.teardown?.();
      } finally {
        vi.unstubAllEnvs();
        if (claude === "unset" && agent !== undefined) process.env.CLAUDECODE = agent;
        if (language !== undefined) setLanguage(null);
      }
    },
  });
}
export function vitestProject(project: Pick<TestProject, "put">): () => void {
  return () => {
    project.put("package.json", '{"devDependencies":{"vitest":"^5.0.0"}}');
    project.put("src/app.ts");
    project.put("test/app.test.ts");
  };
}
