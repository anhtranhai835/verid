import { ROLES, STATIONS } from "../core/kitchen.js";

/**
 * The no-brain board's restaurant: the developer's own pixel art of the dining room, as the room
 * without its crew and the crew alone (scripts/kitchen-art.py cuts them), each crew member a cut
 * of that layer put back on its spot, so only their own pixels move and glow while they work, a live name tag laid over the
 * name printed in the art, the waiter's speech and the pass. kitchen.css draws it, board-ui/
 * kitchen.client.js marks who works and calls out finished work.
 */

// The art is 1024 x 644. Each role: its box in the art and the centre of its printed name. The
// crew's own pixels inside each box are the blocks in scripts/kitchen-art.py.
const W = 1024;
const H = 644;
const CREW: Record<string, { box: [number, number, number, number]; label: [number, number] }> = {
  head_chef: { box: [18, 240, 112, 382], label: [57, 394] },
  cook: { box: [145, 268, 232, 386], label: [185, 399] },
  sous_chef: { box: [262, 268, 348, 386], label: [308, 399] },
  taster: { box: [392, 270, 472, 386], label: [428, 399] },
  inspector: { box: [505, 262, 600, 386], label: [550, 399] },
  waiter: { box: [445, 470, 540, 592], label: [490, 597] },
  customer: { box: [862, 455, 955, 570], label: [908, 583] },
};
// Moving light the art cannot have: fire on both stoves, the oven, steam off the pots, the lamps.
const FX: [string, number, number, number, number][] = [
  ["fire", 92, 205, 46, 52],
  ["fire", 22, 512, 60, 58],
  ["ember", 0, 182, 78, 56],
  ["steam", 404, 182, 44, 40],
  ["steam", 214, 520, 40, 36],
  ["lamp", 180, 52, 52, 40],
  ["lamp", 474, 52, 52, 40],
  ["lamp", 686, 52, 52, 40],
  ["lamp", 882, 52, 52, 40],
];

const pct = (n: number, of: number) => `${((n / of) * 100).toFixed(3)}%`;

type Say = (key: string) => string;

function slot(s: Say, role: string): string {
  const { box, label } = CREW[role]!;
  const [x1, y1, x2, y2] = box;
  const w = x2 - x1;
  const h = y2 - y1;
  const style = [
    `--l:${pct(x1, W)}`,
    `--t:${pct(y1, H)}`,
    `--w:${pct(w, W)}`,
    `--h:${pct(h, H)}`,
    `--bs:${pct(W, w)} ${pct(H, h)}`,
    `--bp:${pct(x1, W - w)} ${pct(y1, H - h)}`,
    `--tx:${pct(label[0] - x1, w)}`,
    `--ty:${pct(label[1] - y1, h)}`,
  ].join(";");
  const state = role === "customer" ? "" : `<span class="k-state">${s("k_idle")}</span>`;
  return `<div class="actor" data-role="${role}" style="${style}" title="${s(`job_${role}`)}"><i class="crop" aria-hidden="true"></i><span class="bubble" aria-hidden="true"></span><span class="tag"><strong>${s(`role_${role}`)}</strong>${state}</span><span class="job">${s(`job_${role}`)}</span></div>`;
}

/**
 * `room` and `crew` are the two layers of the restaurant picture as data: URLs, so the page still
 * loads nothing from outside.
 */
export function kitchenMarkup(s: Say, room: string, crew: string): string {
  const lanes = STATIONS.map(
    (station) =>
      `<li class="lane" data-station="${station}"><h4>${s(`station_${station}`)}<span class="count">0</span></h4><ul class="plates"></ul></li>`,
  ).join("");
  const actors = [...ROLES, "customer"].map((role) => slot(s, role)).join("");
  const fx = FX.map(
    ([kind, x, y, w, h]) =>
      `<i class="fx fx-${kind}" style="left:${pct(x, W)};top:${pct(y, H)};width:${pct(w, W)};height:${pct(h, H)}" aria-hidden="true"></i>`,
  ).join("");
  return `<section class="kitchen" id="kitchen" aria-labelledby="kitchen-title"><div class="k-head"><h2 id="kitchen-title">${s("kitchen_heading")}</h2><p>${s("kitchen_help")}</p></div><div class="scene" style="--art:url(${room});--crew:url(${crew})">${fx}${actors}</div><div class="speech"><p id="waiter-say" role="status" aria-live="polite">${s("waiter_quiet")}</p><p class="next" id="waiter-next-wrap" hidden><strong>${s("waiter_next_label")}</strong> <span id="waiter-next"></span></p><a class="btn primary" id="waiter-answer" href="#chat-input" hidden>${s("waiter_answer")}</a></div><h3>${s("pass_heading")}</h3><ol class="pass">${lanes}</ol></section>`;
}
