export interface RepoFacts {
  /** The repository's top folder: one repository however a call reaches it. */
  top: string;
  /** The branch checked out; null when HEAD is detached. */
  branch: string | null;
  main: MainIdentity;
  heads: readonly string[];
}
/** Work branches start with one of these, then a slash and a name. */
export const WORK_PREFIXES = ["feat", "fix", "chore", "docs", "refactor", "test"] as const;
const WORK_BRANCH = new RegExp(`^(?:${WORK_PREFIXES.join("|")})/.+$`);

export const isWorkBranch = (name: string): boolean => WORK_BRANCH.test(name);

// Conventional Commits 1.0: `<type>[(scope)][!]: <description>`, then a blank line before any body.
const HEADER = /^[A-Za-z]+(?:\([^()\s][^()]*\))?!?: \S/;

/** Whether a full commit message has a Conventional Commit header and a blank line after it. */
export function isConventionalCommit(message: string): boolean {
  const lines = message.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  return HEADER.test(lines[0] ?? "") && (lines.length === 1 || lines[1] === "");
}

/** What tells one Git root which branch is main; the adapter reads it, offline. */
export interface MainFacts {
  /** default_branch of every manifest repo in this root. */
  declared: readonly string[];
  /** The manifest's root `git.default_branch`. */
  rootDefault?: string | undefined;
  /** The branch the local `refs/remotes/origin/HEAD` names; null without it. */
  originHead: string | null;
  /** Local branch names. */
  heads: readonly string[];
}

export type MainIdentity = { ok: true; main: string } | { ok: false; detail: string };

/**
 * Main for one root: a repo's declaration, the root's, the local origin/HEAD, then the sole local
 * main or master. Never the branch checked out now, and never a remote: what cannot be told
 * apart is refused.
 */
export function resolveMain(f: MainFacts): MainIdentity {
  const declared = [...new Set(f.declared)];
  if (declared.length > 1)
    return { ok: false, detail: `conflicting default_branch: ${declared.join(", ")}` };
  const named = declared[0] ?? f.rootDefault ?? f.originHead;
  if (named) return { ok: true, main: named };
  const found = ["main", "master"].filter((name) => f.heads.includes(name));
  if (found.length > 1) return { ok: false, detail: "both main and master exist" };
  return found[0] ? { ok: true, main: found[0] } : { ok: false, detail: "no main branch" };
}

/** One Git root's history since the module's recorded base, as the adapter read it. */
export interface RootHistory {
  /** The repo, by its manifest path. */
  repo: string;
  /** Why the history could not be read: Git gone, a missing base, a failed or too long read. */
  error?: string;
  /** Whether the recorded base is an ancestor of HEAD. */
  ancestor?: boolean;
  /** Every commit in base..HEAD, newest first, with its full message. */
  commits?: readonly { sha: string; message: string }[];
}
export type CloseProblem = {
  code: "VERID_BURNT_GIT_WORK_BASE" | "VERID_BURNT_GIT_COMMIT_MESSAGE";
  params: Record<string, string>;
};

/**
 * What the module's Git history says at close: the first reason it cannot close (a base it
 * cannot trust, or a message that is not a Conventional Commit, oldest first), and the repos with
 * more than one commit, as information only. Several small feature commits are valid; their count
 * never earns a warning or blocks closure. A read that failed is never an empty range.
 */
export function closeHistory(roots: readonly RootHistory[]): {
  problem: CloseProblem | null;
  counts: { repo: string; commits: number }[];
} {
  let problem: CloseProblem | null = null;
  const counts: { repo: string; commits: number }[] = [];
  for (const root of roots) {
    const base = (detail: string): CloseProblem => ({
      code: "VERID_BURNT_GIT_WORK_BASE",
      params: { repo: root.repo, detail },
    });
    if (root.error !== undefined || root.commits === undefined) {
      problem ??= base(root.error ?? "no history read");
      continue;
    }
    if (root.ancestor !== true) {
      problem ??= base("HEAD does not descend from the recorded main commit");
      continue;
    }
    if (root.commits.length > 1) counts.push({ repo: root.repo, commits: root.commits.length });
    const bad = [...root.commits].reverse().find((c) => !isConventionalCommit(c.message));
    problem ??= bad
      ? {
          code: "VERID_BURNT_GIT_COMMIT_MESSAGE",
          params: {
            repo: root.repo,
            commit: bad.sha.slice(0, 12),
            header: bad.message.split(/\r?\n/)[0] ?? "",
          },
        }
      : null;
  }
  return { problem, counts };
}
