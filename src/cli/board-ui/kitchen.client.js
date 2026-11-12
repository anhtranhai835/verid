function renderKitchen() {
  const k = board.kitchen;
  if (!k) return;
  document.querySelectorAll("#kitchen [data-role]").forEach((el) => {
    const on = el.dataset.role === k.role;
    el.classList.toggle("on", on);
    const state = el.querySelector(".k-state");
    if (state) state.textContent = on ? L.k_working : L.k_idle;
  });
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
