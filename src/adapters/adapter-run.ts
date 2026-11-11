import { pluginArgs } from "../core/plugin.js";
import {
  ADAPTER_OUTPUT,
  type AdapterContext,
  type AdapterKind,
  type AdapterOutput,
} from "../core/reheat.js";
import { PLUGIN_TIMEOUT_MS, runPluginCommand } from "./plugin-process.js";
import { VeridError } from "./state-store.js";

const PLACEHOLDER = /\{(legacyRoot|unit|unitDir|specPath)\}/g;
/** One argument that the plugin command parser reads back whole, whatever quotes it holds. */
const quoted = (arg: string): string => `'${arg.replaceAll("'", `'"'"'`)}'`;

/** The adapter's time limit: 300 seconds, or VERID_ADAPTER_TIMEOUT_MS when it holds a number of ms. */
export function adapterTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const set = Number(env.VERID_ADAPTER_TIMEOUT_MS);
  return Number.isInteger(set) && set > 0 ? set : PLUGIN_TIMEOUT_MS;
}

/**
 * Runs one adapter command and returns its output once the shape is proven. The command is split
 * into arguments first and the placeholders filled after, so a value is never read as syntax; no
 * shell is involved. A failed process, a timeout, a document of another shape or one that
 * contradicts the request all end as VERID_BURNT_ADAPTER, before the caller has changed anything.
 */
export async function runAdapter<K extends AdapterKind>(
  command: string,
  cwd: string,
  kind: K,
  context: AdapterContext,
  env: NodeJS.ProcessEnv = {},
  timeoutMs: number = adapterTimeoutMs(),
): Promise<AdapterOutput<K>> {
  const fail = (detail: string) =>
    new VeridError("VERID_BURNT_ADAPTER", {
      step: kind,
      detail: detail.replace(/\s+/g, " ").trim().slice(0, 400),
    });
  let result: Awaited<ReturnType<typeof runPluginCommand>>;
  try {
    const line = pluginArgs(command)
      .map((arg) =>
        quoted(arg.replace(PLACEHOLDER, (_, name: keyof AdapterContext) => context[name])),
      )
      .join(" ");
    result = await runPluginCommand(line, cwd, { ...env, VERID_ADAPTER_STEP: kind }, "", timeoutMs);
  } catch (error) {
    throw fail(error instanceof Error ? error.message : String(error));
  }
  if (result.timedOut)
    throw fail(
      `timed out after ${timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} s` : `${timeoutMs} ms`}`,
    );
  if (result.exit !== 0) throw fail(`exit ${result.exit ?? "none"}: ${result.stderr}`);
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw fail("stdout is not one JSON document");
  }
  const parsed = ADAPTER_OUTPUT[kind].safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw fail(`${issue?.path.join(".") || "output"}: ${issue?.message ?? "wrong shape"}`);
  }
  const output = parsed.data as AdapterOutput<K>;
  if (kind === "inventory") {
    const ids = (output as AdapterOutput<"inventory">).units.map((unit) => unit.id);
    const repeated = ids.find((id, i) => ids.indexOf(id) !== i);
    if (repeated !== undefined) throw fail(`unit ${repeated} appears twice`);
  } else if ((output as AdapterOutput<"extract" | "gate">).unit !== context.unit)
    throw fail(`answers for unit ${(output as AdapterOutput<"gate">).unit}, not ${context.unit}`);
  return output;
}
