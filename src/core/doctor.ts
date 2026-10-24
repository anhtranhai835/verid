/** Node's release string, without guessing from malformed command output. */
export function node22OrLater(version: string): boolean {
  const match = /^v?(\d+)\.\d+\.\d+$/.exec(version.trim());
  return match !== null && Number(match[1]) >= 22;
}
