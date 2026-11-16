/** Node's release string, without guessing from malformed command output. */
export function node22OrLater(version: string): boolean {
  const match = /^v?(\d+)\.\d+\.\d+$/.exec(version.trim());
  return match !== null && Number(match[1]) >= 22;
}

/**
 * A probe that could not start its process at all: Codex's sandbox refuses the spawn with EPERM
 * or EACCES, which says nothing about the install being probed.
 */
export function sandboxBlocked(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return (
    code === "EPERM" || code === "EACCES" || /\bspawn\w*\b.*\bE(?:PERM|ACCES)\b/.test(error.message)
  );
}
