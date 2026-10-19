import * as z from "zod/mini";

// zod/mini ships no messages ("Invalid input"), so the ones a developer needs are spelled out.
const nonEmpty = { error: "must not be empty" };
const glob = z.string().check(z.minLength(1, nonEmpty));

const repo = z.strictObject({
  path: z._default(z.string().check(z.minLength(1, nonEmpty)), "."),
  test_cmd: z
    .string()
    .check(z.includes("{junit}", { error: "must contain {junit}, where the JUnit report goes" })),
  source_globs: z.array(glob).check(z.minLength(1, nonEmpty)),
  test_globs: z.array(glob).check(z.minLength(1, nonEmpty)),
});

/** Only what Phase 1 reads; unknown keys are rejected rather than ignored. */
const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  repos: z.array(repo).check(z.length(1, { error: "Phase 1 supports exactly one repo" })),
});

export type Manifest = z.infer<typeof manifestSchema>;

export type ParseManifestResult = { ok: true; manifest: Manifest } | { ok: false; detail: string };

/** Validates the parsed YAML document. */
export function parseManifest(doc: unknown): ParseManifestResult {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc))
    return { ok: false, detail: "expected a YAML mapping" };
  // Never guess the shape of a version we do not know.
  if ((doc as { schemaVersion?: unknown }).schemaVersion !== 1)
    return { ok: false, detail: "schemaVersion must be 1" };
  const r = manifestSchema.safeParse(doc);
  if (r.success) return { ok: true, manifest: r.data };
  const issue = r.error.issues[0];
  if (!issue) return { ok: false, detail: "invalid" };
  const where = issue.path.join(".") || "manifest";
  const what =
    issue.code === "unrecognized_keys"
      ? `unknown key ${issue.keys.join(", ")}`
      : issue.code === "invalid_type"
        ? `expected ${issue.expected}`
        : issue.message;
  return { ok: false, detail: `${where}: ${what}` };
}
