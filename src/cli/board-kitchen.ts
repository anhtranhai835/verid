import { ROLES, STATIONS } from "../core/kitchen.js";

/**
 * The no-brain board's restaurant: a pixel-art dining room with the crew at their stations, the
 * waiter's speech and the pass. Everything is inline (SVG rects here, CSS in board-ui/kitchen.css);
 * board-ui/kitchen.client.js marks who works, plays their action and calls out finished work.
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
  g: "#9aa3a8",
  b: "#8a5234",
  f: "#f2a03a",
  r: "#c4462b",
  l: "#7fc0d0",
  n: "#5c8f55",
};

// The tool each role holds; kitchen.css moves it while that role works.
const PROPS: Record<string, string[]> = {
  head_chef: ["bbbb", "wwww", "wkkw", "wwww", "wkkw", "wwww"],
  sous_chef: ["...w", "..w.", ".w..", "b..."],
  cook: ["kkkkkkbb", ".kkkk..."],
  taster: ["..gg", ".g..", "g..."],
  inspector: [".kk.", "kllk", "kllk", ".kk.", "...k", "....k"],
  waiter: ["..rn..", ".wwww.", "gggggg"],
};

/** Pixel rows to an SVG: each run of a colour in a row is one rect, so the markup stays small. */
function pixels(rows: string[], colour: Record<string, string>, cls: string): string {
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
  const width = Math.max(...rows.map((row) => row.length));
  return `<svg class="${cls}" viewBox="0 0 ${width} ${rows.length}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rects}</svg>`;
}

function sprite(role: string): string {
  const { hat, coat, accent } = CREW[role]!;
  return pixels([...HATS[hat]!, ...BODY], { ...FIXED, c: coat, a: accent }, "sprite");
}

// The room, in scene units (240 x 150): back wall and kitchen line on top, dining room below.
const r = (x: number, y: number, w: number, h: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const lamp = (x: number) =>
  r(x, 0, 1, 10, "#2a1712") +
  r(x - 4, 10, 9, 3, "#c98a55") +
  r(x - 2, 13, 5, 2, "#ffe6a8") +
  `<rect class="glow" x="${x - 6}" y="15" width="13" height="4" fill="#ffd27a" opacity=".16"/>`;
const windowAt = (x: number) =>
  r(x, 12, 34, 30, "#3d2219") +
  r(x + 2, 14, 30, 26, "#3f6f7d") +
  r(x + 4, 16, 6, 3, "#9fd0db") +
  r(x + 16, 14, 2, 26, "#3d2219") +
  r(x + 2, 26, 30, 2, "#3d2219") +
  r(x + 6, 34, 6, 6, "#2f5a3a") +
  r(x + 22, 30, 8, 10, "#2f5a3a");
const table = (x: number) =>
  r(x - 14, 112, 8, 16, "#5a2f20") +
  r(x + 20, 112, 8, 16, "#5a2f20") +
  r(x - 2, 104, 26, 4, "#b06a3e") +
  r(x - 2, 108, 26, 2, "#7a4229") +
  r(x + 1, 110, 2, 18, "#5a2f20") +
  r(x + 19, 110, 2, 18, "#5a2f20") +
  r(x + 4, 101, 6, 3, "#fbf7ee") +
  r(x + 14, 101, 6, 3, "#fbf7ee") +
  r(x + 11, 98, 2, 6, "#5c8f55");
const tiles = Array.from({ length: 30 }, (_, i) =>
  Array.from({ length: 10 }, (_, j) =>
    (i + j) % 2 ? r(i * 8, 76 + j * 8, 8, 8, "#7d5034") : "",
  ).join(""),
).join("");

const ROOM = [
  r(0, 0, 240, 76, "#6b3a2a"),
  r(0, 0, 240, 5, "#3d2219"),
  r(0, 44, 240, 2, "#3d2219"),
  r(0, 46, 240, 18, "#7a4a32"),
  ...[20, 60, 100, 140, 180, 220].map((x) => r(x, 46, 1, 18, "#5e3423")),
  // order board and the shelf of pots
  r(8, 12, 30, 24, "#3d2219"),
  r(10, 14, 26, 20, "#2f3b2f"),
  r(13, 18, 14, 1, "#e9e2cf"),
  r(13, 22, 18, 1, "#e9e2cf"),
  r(13, 26, 10, 1, "#e9e2cf"),
  r(56, 26, 70, 3, "#3d2219"),
  r(60, 18, 10, 8, "#9aa3a8"),
  r(76, 20, 8, 6, "#c98a55"),
  r(90, 16, 12, 10, "#9aa3a8"),
  r(108, 20, 8, 6, "#c4462b"),
  windowAt(150),
  windowAt(196),
  lamp(48),
  lamp(118),
  lamp(167),
  lamp(213),
  // the kitchen line: counter, stove and its fire, the pass shelf
  r(0, 64, 140, 4, "#c98a55"),
  r(0, 68, 140, 8, "#8a5234"),
  r(18, 60, 26, 4, "#26252d"),
  `<rect class="fire" x="24" y="58" width="5" height="2" fill="#f2a03a"/><rect class="fire" x="33" y="58" width="5" height="2" fill="#f2a03a"/>`,
  // the floor and the dining room
  r(0, 76, 240, 74, "#8a5a3c"),
  tiles,
  r(140, 62, 100, 14, "#7a4a32"),
  r(226, 56, 10, 20, "#5a2f20"),
  r(222, 44, 18, 14, "#2f5a3a"),
  table(30),
  table(104),
  table(180),
].join("");

type Say = (key: string) => string;

const actor = (s: Say, role: string) =>
  `<div class="actor" data-role="${role}" title="${s(`job_${role}`)}"><span class="bubble" aria-hidden="true"></span>${PROPS[role] ? pixels(PROPS[role], FIXED, "prop") : ""}${role === "cook" ? '<i class="steam" aria-hidden="true"></i>' : ""}${sprite(role)}<span class="tag"><strong>${s(`role_${role}`)}</strong>${role === "customer" ? "" : `<span class="k-state">${s("k_idle")}</span>`}</span><span class="job">${s(`job_${role}`)}</span></div>`;

export function kitchenMarkup(s: Say): string {
  const lanes = STATIONS.map(
    (station) =>
      `<li class="lane" data-station="${station}"><h4>${s(`station_${station}`)}<span class="count">0</span></h4><ul class="plates"></ul></li>`,
  ).join("");
  const crew = [...ROLES, "customer"].map((role) => actor(s, role)).join("");
  return `<section class="kitchen" id="kitchen" aria-labelledby="kitchen-title"><div class="k-head"><h2 id="kitchen-title">${s("kitchen_heading")}</h2><p>${s("kitchen_help")}</p></div><div class="scene"><svg class="room" viewBox="0 0 240 150" preserveAspectRatio="none" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${ROOM}</svg>${crew}</div><div class="speech"><p id="waiter-say" role="status" aria-live="polite">${s("waiter_quiet")}</p><p class="next" id="waiter-next-wrap" hidden><strong>${s("waiter_next_label")}</strong> <span id="waiter-next"></span></p><a class="btn primary" id="waiter-answer" href="#chat-input" hidden>${s("waiter_answer")}</a></div><h3>${s("pass_heading")}</h3><ol class="pass">${lanes}</ol></section>`;
}
