import { ROLES, STATIONS } from "../core/kitchen.js";

/**
 * The no-brain board's restaurant: pixel-art crew, the waiter's speech and the pass. Everything is
 * inline (SVG rects here, CSS in board-ui/kitchen.css); board-ui/kitchen.client.js fills it in the
 * browser from the snapshot's `kitchen`, built from state.
 */

// One character per pixel, 8 wide. k outline, s skin, m mouth, p trousers, h hair, w white,
// c the role's coat, a its accent. A hat sits in the 4 rows above the 10-row body.
const BODY = [
  ".ssssss.",
  ".skssks.",
  ".ssmmss.",
  "..ssss..",
  ".cccccc.",
  "cccaaccc",
  "sccaaccs",
  ".cccccc.",
  ".pp..pp.",
  ".kk..kk.",
];
const HATS: Record<string, string[]> = {
  tall: ["..wwww..", ".wwwwww.", ".wwwwww.", ".wwwwww."],
  short: ["........", "........", ".wwwwww.", ".wwwwww."],
  cap: ["........", "........", "..aaaa..", ".aaaaaa."],
  hair: ["........", "........", "........", ".hhhhhh."],
  fedora: ["........", "..kkkk..", "..kkkk..", "kkkkkkkk"],
  curls: ["........", "........", "..hhhh..", ".hhhhhh."],
};
const CREW: Record<string, { hat: string; coat: string; accent: string }> = {
  head_chef: { hat: "tall", coat: "#fbf7ee", accent: "#c4462b" },
  sous_chef: { hat: "short", coat: "#fbf7ee", accent: "#2f8a80" },
  cook: { hat: "cap", coat: "#f1e2c2", accent: "#e08a2c" },
  taster: { hat: "hair", coat: "#5c8f55", accent: "#f2d38a" },
  inspector: { hat: "fedora", coat: "#9a7650", accent: "#efe2c8" },
  waiter: { hat: "hair", coat: "#26252d", accent: "#fbf7ee" },
  customer: { hat: "curls", coat: "#3f6fa8", accent: "#f2d38a" },
};
const FIXED: Record<string, string> = {
  k: "#1f1b17",
  s: "#e9b48c",
  m: "#a9503e",
  p: "#3a3946",
  h: "#4a2f22",
  w: "#fbf7ee",
};

/** One sprite: each run of a colour in a row is one rect, so the SVG stays small. */
export function sprite(role: string): string {
  const { hat, coat, accent } = CREW[role]!;
  const colour: Record<string, string> = { ...FIXED, c: coat, a: accent };
  const rows = [...HATS[hat]!, ...BODY];
  let rects = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const pixel = row[x]!;
      let end = x + 1;
      while (row[end] === pixel) end++;
      if (pixel !== ".")
        rects += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${colour[pixel]}"/>`;
      x = end;
    }
  });
  return `<svg class="sprite" viewBox="0 0 8 ${rows.length}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rects}</svg>`;
}

type Say = (key: string) => string;

const member = (s: Say, role: string, tag = "li") =>
  `<${tag} class="crew-member" data-role="${role}">${sprite(role)}<strong>${s(`role_${role}`)}</strong><span class="job">${s(`job_${role}`)}</span>${role === "customer" ? "" : `<span class="k-state">${s("k_idle")}</span>`}</${tag}>`;

export function kitchenMarkup(s: Say): string {
  const crew = ROLES.filter((role) => role !== "waiter")
    .map((role) => member(s, role))
    .join("");
  const lanes = STATIONS.map(
    (station) =>
      `<li class="lane" data-station="${station}"><h4>${s(`station_${station}`)}<span class="count">0</span></h4><ul class="plates"></ul></li>`,
  ).join("");
  return `<section class="kitchen" id="kitchen" aria-labelledby="kitchen-title"><div class="k-head"><h2 id="kitchen-title">${s("kitchen_heading")}</h2><p>${s("kitchen_help")}</p></div><ul class="crew">${crew}</ul><div class="waiter-row">${member(s, "waiter", "div")}<div class="speech"><p id="waiter-say" role="status" aria-live="polite">${s("waiter_quiet")}</p><p class="next" id="waiter-next-wrap" hidden><strong>${s("waiter_next_label")}</strong> <span id="waiter-next"></span></p><a class="btn primary" id="waiter-answer" href="#chat-input" hidden>${s("waiter_answer")}</a></div>${member(s, "customer", "div")}</div><h3>${s("pass_heading")}</h3><ol class="pass">${lanes}</ol></section>`;
}
