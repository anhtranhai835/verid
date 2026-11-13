let kitchenRole = null,
  kitchenColumns = null;
function bubble(role, text) {
  const el = document.querySelector(`#kitchen [data-role="${role}"] .bubble`);
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(el.hideTimer);
  el.hideTimer = setTimeout(() => el.classList.remove("show"), 8000);
}
// A toast here, and a system notification when the developer allowed them (asked on the first run).
function announce(text) {
  toast(text);
  try {
    if (window.Notification?.permission === "granted") new Notification("Verid", { body: text });
  } catch {}
}
function renderKitchen() {
  const k = board.kitchen;
  if (!k) return;
  document.querySelectorAll("#kitchen [data-role]").forEach((el) => {
    const on = el.dataset.role === k.role;
    el.classList.toggle("on", on);
    const state = el.querySelector(".k-state");
    if (state) state.textContent = on ? L.k_working : L.k_idle;
  });
  // Work handed on: the role that stopped says so; a module reaching done is a dish served.
  if (kitchenRole && kitchenRole !== k.role) {
    bubble(kitchenRole, L.k_done_bubble);
    announce(fmt("toast_role_done", { from: L["role_" + kitchenRole], to: L["role_" + k.role] }));
  }
  kitchenRole = k.role;
  if (kitchenColumns)
    for (const task of board.tasks) {
      const before = kitchenColumns.get(task.id);
      if (task.column === "done" && before && before !== "done") {
        bubble("waiter", fmt("k_dish_bubble", { title: task.title }));
        bubble("customer", L.k_yum);
        announce(fmt("toast_dish_done", { title: task.title }));
      }
    }
  kitchenColumns = new Map(board.tasks.map((task) => [task.id, task.column]));
  const w = k.waiter;
  $("kitchen").classList.toggle("calling", !!w);
  $("waiter-say").textContent = w ? w.say : L.waiter_quiet;
  $("waiter-next").textContent = w ? w.next : "";
  $("waiter-next-wrap").hidden = !w;
  $("waiter-answer").hidden = !w;
  document.querySelectorAll("#kitchen [data-station]").forEach((lane) => {
    const plates = k.pass.filter((p) => p.station === lane.dataset.station);
    lane.querySelector(".count").textContent = plates.length;
    lane.querySelector(".plates").replaceChildren(
      ...plates.map((p) => {
        const li = node("li", "plate", p.title);
        li.title = p.id;
        return li;
      }),
    );
  });
}
afterRender.push(renderKitchen);
$("waiter-answer").onclick = () => showTab("chat");
