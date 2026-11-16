import { t } from "../adapters/i18n.js";
import { readAudit } from "../adapters/audit-log.js";
import { usageReport } from "../core/usage.js";
import { languageOf, statePaths } from "../adapters/state-store.js";
import type { CliResult } from "./test.js";
import { usage } from "./help.js";
import { systemLang } from "./shell.js";

export function usageCommand(project: string, args: string[]): CliResult {
  const modules = args.filter((arg) => !arg.startsWith("--"));
  if (
    modules.length > 1 ||
    args.filter((arg) => arg === "--json").length > 1 ||
    args.some((arg) => arg.startsWith("-") && arg !== "--json")
  )
    return usage(project, {
      key: "usage.unexpected",
      params: { command: "usage", args: args.join(" ") },
    });
  const rows = usageReport(readAudit(statePaths(project).audit)).filter(
    (row) => modules.length === 0 || row.module === modules[0],
  );
  if (args.includes("--json"))
    return { exit: 0, stdout: JSON.stringify(rows, null, 2) + "\n", stderr: "" };
  const lang = languageOf(project) ?? systemLang();
  const lines = [
    t(lang, "ledger.columns", {}),
    ...rows.map((row) =>
      [
        row.module,
        row.sessions,
        row.taste,
        row.denied,
        row.stopBlocked,
        row.chars,
        row.tokens
          ? `${row.tokens.input}/${row.tokens.cached}/${row.tokens.output} (${row.tokens.total})`
          : t(lang, "ledger.unavailable", {}),
      ].join(" | "),
    ),
    t(lang, "ledger.scope", {}),
  ];
  return { exit: 0, stdout: lines.join("\n") + "\n", stderr: "" };
}
