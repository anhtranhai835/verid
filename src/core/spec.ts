/** A requirement line of `.verid/spec.md`: `- REQ-1: …`, `- NFR-2: …`, `- SEC-3: …`. */
const REQUIREMENT = /^[ \t]*[-*][ \t]+((?:REQ|NFR|SEC)-\d+):/;
/** A plan line that may cite requirements: an AC, or a Review Focus saying why none covers one. */
const CITING = /^[ \t]*(?:[-*][ \t]+AC-\d+\b|Review Focus:)/;
const CITED = /(?<![A-Za-z0-9-])((?:REQ|NFR|SEC)-\d+)(?!\d)/g;

export interface SpecTrace {
  /** Live requirements no AC or Review Focus line cites, in spec order. */
  uncovered: string[];
  /** Cited IDs the spec does not have, or has dropped, in plan order. */
  unknown: string[];
}

/** How the plan's ACs trace to the spec. A requirement followed by a `Dropped` line is retired. */
export function specTrace(spec: string, plan: string): SpecTrace {
  const live: string[] = [];
  let last: string | undefined;
  for (const line of spec.split(/\r?\n/)) {
    const id = REQUIREMENT.exec(line)?.[1];
    if (id !== undefined) {
      live.push(id);
      last = id;
    } else if (last !== undefined && /^[ \t]*Dropped\b/.test(line)) {
      live.splice(live.lastIndexOf(last), 1);
      last = undefined;
    }
  }
  const cited = [
    ...new Set(
      plan
        .split(/\r?\n/)
        .filter((line) => CITING.test(line))
        .flatMap((line) => [...line.matchAll(CITED)].map((m) => m[1]!)),
    ),
  ];
  return {
    uncovered: live.filter((id) => !cited.includes(id)),
    unknown: cited.filter((id) => !live.includes(id)),
  };
}
