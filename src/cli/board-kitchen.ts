import { ROLES, STATIONS } from "../core/kitchen.js";

/**
 * The no-brain board's restaurant: pixel-art crew, the waiter's speech and the pass. Everything is
 * inline (SVG rects and CSS); the browser fills it from the snapshot's `kitchen`, built from state.
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

export const KITCHEN_CSS = `.kitchen{margin:0 0 28px;padding:24px;border-radius:14px;color:#f3ead8;border:1px solid #454238;background:#2b2924 repeating-conic-gradient(#ffffff07 0 25%,transparent 0 50%) 0 0/24px 24px}.k-head h2{margin:0;font-size:20px;color:#fff4dc}.k-head p{margin:4px 0 18px;color:#d6ccb8;font-size:13px}.crew,.pass,.plates{list-style:none;margin:0;padding:0}.crew{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.crew-member{display:flex;flex-direction:column;align-items:center;text-align:center;gap:4px;padding:14px 8px 12px;border-radius:10px;background:#36332c;border:2px solid #4a463c}.crew-member strong{font-size:13px;color:#fff4dc}.job{font-size:11px;color:#d6ccb8;line-height:1.35}.k-state{margin-top:4px;font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:#c3b79f;font-weight:700}.crew-member.on{border-color:#e6ab78;background:#433d31}.crew-member.on .k-state{color:#ffd29e}.kitchen .sprite{width:48px;height:84px;margin-bottom:6px}.crew-member.on .sprite,.calling [data-role=waiter] .sprite{animation:k-hop .7s linear infinite}@keyframes k-hop{50%,100%{transform:translateY(-3px)}}.waiter-row{display:grid;grid-template-columns:132px 1fr 132px;align-items:end;gap:16px;margin:20px 0 22px}.speech{position:relative;background:#fbf4e4;color:#39352e;border-radius:4px;padding:14px 16px;border:3px solid #1f1b17;box-shadow:4px 4px 0 #1f1b17}.speech::before{content:"";position:absolute;left:-15px;bottom:22px;border:6px solid transparent;border-right-color:#1f1b17}.speech p{margin:0;font-size:14px;line-height:1.5}.speech .next{margin-top:8px;font-size:13px}.speech a.btn{display:inline-flex;margin-top:12px;text-decoration:none;flex:none}.calling .speech{border-color:#c4462b;box-shadow:4px 4px 0 #c4462b}.kitchen h3{margin:0 0 10px;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#f0b886}.pass{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.lane{background:#1f1d19;border-radius:8px;padding:10px;min-height:96px;border-top:4px solid #a79b83}.lane[data-station=RAW]{border-top-color:#d77a61}.lane[data-station=COOKING]{border-top-color:#e6ab78}.lane[data-station=PLATED]{border-top-color:#8bd5b1}.lane[data-station=served]{border-top-color:#9cc3e6}.lane h4{margin:0 0 8px;font-size:11px;color:#f3ead8;display:flex;justify-content:space-between;gap:6px}.plates{display:grid;gap:6px}.plate{position:relative;font-size:12px;line-height:1.35;background:#fbf4e4;color:#39352e;padding:6px 8px;border-radius:3px;box-shadow:2px 2px 0 #0007;overflow-wrap:anywhere}.lane[data-station=COOKING] .plate::after{content:"";position:absolute;right:10px;top:-6px;width:3px;height:3px;background:#fff;box-shadow:4px -4px 0 #fffa,0 -8px 0 #fff8;animation:k-steam 1.2s steps(3) infinite}@keyframes k-steam{to{transform:translateY(-6px);opacity:0}}@media (max-width:900px){.crew{grid-template-columns:repeat(3,minmax(0,1fr))}.pass{grid-template-columns:repeat(2,minmax(0,1fr))}.waiter-row{grid-template-columns:1fr}}@media (prefers-reduced-motion:reduce){.kitchen *,.kitchen *::after{animation:none!important}}`;

/** Paints the snapshot's kitchen; render() calls it on every refresh. */
export const KITCHEN_JS = `function renderKitchen(){const k=board.kitchen;if(!k)return;document.querySelectorAll('#kitchen [data-role]').forEach(el=>{const on=el.dataset.role===k.role;el.classList.toggle('on',on);const state=el.querySelector('.k-state');if(state)state.textContent=on?L.k_working:L.k_idle});const w=k.waiter;$('kitchen').classList.toggle('calling',!!w);$('waiter-say').textContent=w?w.say:L.waiter_quiet;$('waiter-next').textContent=w?w.next:'';$('waiter-next-wrap').hidden=!w;$('waiter-answer').hidden=!w;document.querySelectorAll('#kitchen [data-station]').forEach(lane=>{const plates=k.pass.filter(p=>p.station===lane.dataset.station);lane.querySelector('.count').textContent=plates.length;lane.querySelector('.plates').replaceChildren(...plates.map(p=>{const li=node('li','plate',p.title);li.title=p.id;return li}))})}`;
