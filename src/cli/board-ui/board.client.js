"use strict";
const $ = (id) => document.getElementById(id);
const L = JSON.parse($("board-data").textContent),
  afterRender = [],
  fmt = (k, p) => L[k].replace(/\{(\w+)\}/g, (m, n) => (n in p ? String(p[n]) : m));
const chatDrafts = new Map();
let chatStation = "",
  chat = null,
  board = null,
  filter = "all",
  query = "",
  taskId = null,
  docKind = "spec",
  busy = false,
  dragId = null,
  timer;
const columns = ["backlog", "selected", "progress", "review", "done"].map((k) => [
  k,
  L["col_" + k],
  L["col_" + k + "_empty"],
]);
function node(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
function toast(message, error = false) {
  clearTimeout(timer);
  $("toast").textContent = message;
  $("toast").className = "toast visible" + (error ? " error" : "");
  timer = setTimeout(() => ($("toast").className = "toast"), error ? 9000 : 4500);
}
async function request(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || L.err_action);
  return result;
}
async function refresh() {
  try {
    board = await request("/api/board");
    render();
    $("connection").textContent = fmt("synced", {
      time: new Date().toLocaleTimeString(L.locale, { hour: "2-digit", minute: "2-digit" }),
    });
    return true;
  } catch (error) {
    $("connection").textContent = L.disconnected;
    $("notice").textContent = error.message;
    $("notice").className = "notice visible";
    return false;
  }
}
async function act(action, extra = {}) {
  if (busy || !board) return null;
  busy = true;
  document.querySelectorAll("button").forEach((b) => (b.dataset.wasDisabled = String(b.disabled)));
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const result = await request("/api/action", { action, revision: board.revision, ...extra });
    if (action !== "prompt") {
      board = result;
      render();
    }
    return result;
  } catch (error) {
    toast(error.message, true);
    await refresh();
    return null;
  } finally {
    busy = false;
    document.querySelectorAll("button").forEach((b) => {
      if (b.dataset.wasDisabled !== undefined) {
        b.disabled = b.dataset.wasDisabled === "true";
        delete b.dataset.wasDisabled;
      }
    });
    render();
    if ($("task-dialog").open) renderTask();
  }
}
function render() {
  if (!board) return;
  const conversation = $("chat-station");
  if (conversation) {
    const names = board.tasks.filter((t) => t.station).map((t) => t.id);
    const signature = names.join(",");
    if (conversation.dataset.list !== signature) {
      conversation.replaceChildren(
        ...["", ...names].map((id) => {
          const option = node("option", "", id || L.chat_primary);
          option.value = id;
          return option;
        }),
      );
      conversation.dataset.list = signature;
      if (!names.includes(chatStation)) {
        chatStation = "";
        chat = null;
      }
      conversation.value = chatStation;
    }
  }
  for (const paint of afterRender) paint();
  const auto = board.drive === "auto";
  $("sign-box").hidden = !auto;
  $("chat-box").hidden = !auto;
  $("tab-chat").hidden = !auto;
  $("tab-sign").hidden = !auto;
  $("tab-chat").classList.toggle("live", !!chat?.running);
  if ($("tab-" + $("work").dataset.tab)?.hidden) showTab("kanban");
  $("drag-hint").textContent = auto ? L.drag_hint : L.drag_hint_human;
  if (auto) {
    const d = board.documents;
    $("summary-doc").hidden = !d.summary.trim();
    $("summary-text").textContent = d.summary;
    $("research-text").textContent = d.research || L.doc_missing;
    $("design-text").textContent = d.design || L.doc_missing;
    $("sign-state").textContent = board.signed ? L.signed : L.not_signed;
    $("sign-btn").disabled = busy || board.signed || !d.research.trim() || !d.design.trim();
    if (!chat) refreshChat();
  }
  $("project").textContent = board.project;
  $("drive-label").textContent = "Drive " + (board.drive === "auto" ? "no-brain" : "big-brain");
  $("drive-guide").textContent = board.drive === "auto" ? L.guide_auto : L.guide_human;
  $("drive-footer").textContent = board.drive === "auto" ? L.footer_auto : L.footer_human;
  $("step-session").title = board.drive === "auto" ? L.step_session_auto : L.step_session_title;
  $("aside-project").textContent = board.project;
  $("total-count").textContent = board.tasks.length;
  const done = board.tasks.filter((t) => t.column === "done").length;
  $("completion").textContent = fmt("completion", { done, total: board.tasks.length });
  $("progress").style.width = (board.tasks.length ? (done / board.tasks.length) * 100 : 0) + "%";
  $("cycle").textContent = board.active
    ? fmt("cycle_active", { module: board.active.module, tdd: board.tdd }) +
      (board.dirty ? L.cycle_dirty : "")
    : L.cycle_idle;
  const step = !board.spec
    ? "spec"
    : !board.tasks.length
      ? "tasks"
      : !board.active
        ? "select"
        : "session";
  ["spec", "tasks", "select", "session"].forEach((id) =>
    $("step-" + id).classList.toggle("current", id === step),
  );
  $("docs-btn").disabled = !!board.notice;
  $("split-btn").disabled = !!board.notice || busy || !!board.plan || !board.spec || !!board.active;
  $("split-btn").title = board.plan ? L.split_has_plan : L.split_title;
  const notes = [];
  if (board.notice) notes.push(board.notice);
  if (board.drive === "auto" && !board.notice) notes.push(L.note_auto);
  const cooking = board.tasks.filter((t) => t.column === "progress").length;
  if (cooking > 1) notes.push(fmt("warn_parallel", { count: cooking }));
  if (board.halted) notes.push(fmt("halted", { reason: board.halted }));
  if (board.planError) notes.push(fmt("plan_error", { detail: board.planError }));
  if (board.active && board.tasks.some((t) => t.needsReapproval)) notes.push(L.note_reapprove);
  if (board.missing.length && board.tasks.length)
    notes.push(fmt("note_missing", { files: board.missing.map((f) => ".verid/" + f).join(", ") }));
  $("notice").textContent = notes.join("\n");
  $("notice").className = "notice" + (notes.length ? " visible" : "");
  $("welcome").className = "welcome" + (!board.tasks.length && !board.notice ? " visible" : "");
  $("welcome-title").textContent = board.spec ? L.welcome_spec_title : L.welcome_empty_title;
  $("welcome-text").textContent = board.spec ? L.welcome_spec_text : L.welcome_empty_text;
  $("welcome-btn").textContent = board.plan ? L.edit_plan : board.spec ? L.split_btn : L.add_spec;
  const root = $("columns");
  const scroll = root.scrollLeft;
  const focused = root.contains(document.activeElement)
    ? document.activeElement.closest("[data-task]")?.dataset.task
    : null;
  root.replaceChildren();
  for (const [key, label, empty] of columns) {
    const section = node("section", "column");
    section.dataset.column = key;
    section.setAttribute("aria-label", label);
    const head = node("div", "column-head");
    head.append(
      node("span", "dot"),
      node("span", "", label),
      node("span", "count", String(board.tasks.filter((t) => t.column === key).length)),
      node("span", "decor", "···"),
    );
    section.append(head);
    const items = board.tasks.filter(
      (t) =>
        t.column === key &&
        (filter === "all" ||
          (filter === "done" && t.column === "done") ||
          (filter === "active" && t.selected)) &&
        (!query ||
          (t.title + " " + t.id + " " + t.requirements.join(" "))
            .toLocaleLowerCase()
            .includes(query)),
    );
    for (const task of items) {
      const card = node("article", "card" + (task.selected ? " selected" : ""));
      card.tabIndex = 0;
      card.setAttribute("role", "group");
      card.dataset.task = task.id;
      card.onkeydown = (e) => {
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && task.canMove) {
          e.preventDefault();
          act("move", { task: task.id, direction: e.key === "ArrowUp" ? "up" : "down" });
        } else if (e.target === card && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          openTask(task.id);
        }
      };
      card.setAttribute("aria-label", fmt("card_aria", { id: task.id, title: task.title }));
      const top = node("div", "card-top");
      top.append(
        node("span", "task-id", String(board.tasks.indexOf(task) + 1) + ". " + task.id),
        node(
          "span",
          "tag" + (task.id === "product" ? " product" : ""),
          task.id === "product" ? L.tag_product : task.requirements[0] || "Task",
        ),
      );
      card.append(top, node("h3", "", task.title));
      if (task.station) {
        const status = node(
          "span",
          "chip",
          fmt("station", { module: task.id, tdd: task.station.tdd }),
        );
        status.setAttribute("aria-label", status.textContent);
        card.append(status);
        if (task.station.served) card.append(node("p", "card-note", L.station_waiting));
      }
      if (task.next && board.drive === "human") card.append(node("span", "chip", L.next));
      const dossier = node(
        "span",
        "chip",
        task.dossier.missing.length
          ? fmt("dossier_missing", { count: task.dossier.missing.length })
          : task.dossier.unresolved
            ? fmt("dossier_unresolved", { count: task.dossier.unresolved })
            : L.dossier_ready,
      );
      dossier.setAttribute("aria-label", dossier.textContent);
      card.append(dossier);
      if (task.migration) {
        const unit = node(
          "span",
          "chip",
          L["gate_" + task.migration.gate] + " · " + L["parity_" + task.migration.parityState],
        );
        unit.setAttribute("aria-label", unit.textContent);
        card.append(unit);
      }
      if (task.usage) {
        const tokens = task.usage.tokens;
        card.append(
          node(
            "span",
            "chip",
            tokens
              ? fmt("tokens", { count: tokens.total.toLocaleString(L.locale) })
              : L.tokens_none,
          ),
        );
      }
      if (task.canMove) {
        const controls = node("div", "buttons");
        for (const [direction, label] of [
          ["up", "↑"],
          ["down", "↓"],
        ]) {
          const move = node("button", "btn", label);
          move.setAttribute(
            "aria-label",
            fmt(direction === "up" ? "move_up" : "move_down", { id: task.id }),
          );
          move.dataset.task = task.id;
          move.dataset.move = direction;
          const pending = board.tasks.filter((t) => t.canMove);
          move.disabled =
            busy ||
            (direction === "up" ? pending[0].id === task.id : pending.at(-1).id === task.id);
          move.onclick = (e) => {
            e.stopPropagation();
            act("move", { task: task.id, direction });
          };
          controls.append(move);
        }
        card.append(controls);
      }
      if (task.waiting.length)
        card.append(node("p", "card-note", fmt("waiting", { list: task.waiting.join(", ") })));
      const bottom = node("div", "card-bottom");
      bottom.append(
        node("span", "", fmt("criteria", { count: task.acs.length })),
        node(
          "span",
          "",
          task.column === "done" ? L.served : task.selected ? L.ticket_open : L.view_ticket,
        ),
      );
      card.append(bottom);
      card.onclick = () => openTask(task.id);
      card.draggable = columns.some(([target]) => dropAction(task, target));
      card.ondragstart = (e) => {
        dragId = task.id;
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
        card.classList.add("dragging");
        root
          .querySelectorAll(".column")
          .forEach((col) =>
            col.classList.toggle("drop-ok", !!dropAction(task, col.dataset.column)),
          );
      };
      card.ondragend = () => {
        dragId = null;
        card.classList.remove("dragging");
        root
          .querySelectorAll(".column")
          .forEach((col) => col.classList.remove("drop-ok", "drop-over"));
      };
      section.append(card);
    }
    section.ondragover = (e) => {
      if (
        !dropAction(
          board.tasks.find((t) => t.id === dragId),
          key,
        )
      )
        return;
      e.preventDefault();
      section.classList.add("drop-over");
    };
    section.ondragleave = (e) => {
      if (!section.contains(e.relatedTarget)) section.classList.remove("drop-over");
    };
    section.ondrop = (e) => {
      e.preventDefault();
      const id = dragId || e.dataTransfer.getData("text/plain");
      section.classList.remove("drop-over");
      drop(id, key);
    };
    if (!items.length)
      section.append(node("div", "column-empty", query || filter !== "all" ? L.no_match : empty));
    root.append(section);
  }
  root.scrollLeft = scroll;
  if (focused) {
    const target = Array.from(root.querySelectorAll(".card")).find(
      (card) => card.dataset.task === focused,
    );
    if (target) target.focus({ preventScroll: true });
  }
}

// Where a card may go by drag. No-brain: into Cooking starts an AI run. Big-brain: picking a
// ticket selects it, and Done serves a ticket that passed review.
function dropAction(task, column) {
  if (!task || task.column === column || busy) return null;
  if (board.drive === "auto")
    return column === "progress" && (task.column === "backlog" || task.column === "selected")
      ? "run"
      : null;
  if (column === "selected" && task.column === "backlog" && !task.reason) return "select";
  if (column === "done" && task.canServe) return "serve";
  return null;
}
async function drop(id, column) {
  const task = board.tasks.find((t) => t.id === id);
  const action = dropAction(task, column);
  if (action === "run") return runTask(task);
  if (action === "select") {
    taskId = id;
    await selectTask(id);
    openTask(id);
  } else if (action === "serve" && (await act("serve", { task: id }))) toast(L.toast_served);
}
function confirmRun(count) {
  $("run-text").textContent = fmt("run_warn_text", { count });
  $("run-dialog").returnValue = "";
  $("run-dialog").showModal();
  return new Promise((resolve) =>
    $("run-dialog").addEventListener("close", () => resolve($("run-dialog").returnValue === "go"), {
      once: true,
    }),
  );
}
async function runTask(task) {
  // Each run is its own AI session reading its own context: warn before a second one starts.
  const live = Math.max(
    board.tasks.filter((t) => t.column === "progress").length,
    chat?.running ? 1 : 0,
  );
  if (live > 0 && !(await confirmRun(live))) return;
  try {
    if (window.Notification?.permission === "default") Notification.requestPermission();
  } catch {}
  if (!chat) await refreshChat();
  const provider = $("chat-provider").value || chat?.providers[0] || "";
  const result = await act("run", { task: task.id, provider });
  if (!result) return;
  toast(fmt("toast_run", { id: task.id }));
  chat = null;
  refreshChat();
}
function openTask(id) {
  mockupView = false;
  mockupKey = "";
  taskId = id;
  $("prompt").value = "";
  renderTask();
  $("task-dialog").showModal();
  const task = board.tasks.find((t) => t.id === id);
  if (
    board.drive === "human" &&
    task &&
    !task.station &&
    task.selected &&
    !task.needsReapproval &&
    board.active?.session === null
  )
    loadPrompt();
}
function renderMigration(task) {
  const box = $("task-migration");
  box.replaceChildren();
  const m = task.migration;
  if (!m) return;
  box.append(
    node("h3", "", L.migration_heading),
    node(
      "p",
      "",
      [
        m.family && fmt("migration_family", { family: m.family }),
        m.parent && fmt("migration_parent", { parent: m.parent }),
        m.extracted ? L.migration_extract_yes : L.migration_extract_no,
        L["gate_" + m.gate],
        L["parity_" + m.parityState],
      ]
        .filter(Boolean)
        .join(" · "),
    ),
  );
  if (m.canSignParity && board.drive === "auto") {
    const sign = node("button", "btn primary", L.parity_sign);
    sign.setAttribute("aria-label", fmt("parity_sign_aria", { id: task.id }));
    sign.disabled = busy;
    sign.onclick = async () => {
      const result = await act("parity", { task: task.id });
      if (result) toast(L.toast_parity_signed);
    };
    box.append(node("p", "help", L.parity_sign_help), sign);
  } else if (board.drive === "human" && m.gate === "pass" && m.parityState !== "signed")
    box.append(node("p", "help", fmt("parity_terminal", { id: task.id })));
}
function renderTask() {
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task) {
    $("task-dialog").close();
    return;
  }
  renderMockups(task);
  $("task-id").textContent = task.id;
  $("task-title").textContent = task.title;
  $("task-chips").replaceChildren(...task.requirements.map((id) => node("span", "chip", id)));
  $("task-acs").replaceChildren(...task.acs.map((ac) => node("li", "", ac)));
  $("task-depends").replaceChildren();
  if (task.depends.length) {
    $("task-depends").append(
      node("h3", "", L.depends_heading),
      node("p", "", task.depends.join(", ")),
    );
  }
  renderMigration(task);
  $("task-reason").textContent = task.needsReapproval
    ? L.reason_reapprove
    : task.reason ||
      (task.waiting.length
        ? L.reason_waiting
        : task.selected
          ? board.active?.session === null
            ? L.reason_selected
            : task.canServe
              ? L.reason_can_serve
              : L.reason_in_progress
          : L.reason_pick);
  if (task.station) {
    $("session-box").hidden = true;
    $("task-reason").textContent = task.reason + " / " + task.station.path;
    $("task-actions").replaceChildren(
      node("span", "chip", fmt("station", { module: task.id, tdd: task.station.tdd })),
    );
    return;
  }
  if (board.drive === "auto") {
    $("session-box").hidden = true;
    $("task-actions").replaceChildren(
      node("span", "chip", task.column === "done" ? L.served : L.auto_chip),
    );
    $("task-reason").textContent = task.reason || L.reason_auto;
    return;
  }
  $("session-box").hidden = !task.selected;
  const waiting = task.selected && board.active?.session === null;
  $("session-heading").textContent = waiting ? L.session_heading_new : L.session_heading_bound;
  $("session-guide").textContent = waiting ? L.session_guide_new : L.session_guide_bound;
  $("prompt").hidden = !waiting;
  const actions = $("task-actions");
  actions.replaceChildren();
  if (task.selected) {
    const copy = node("button", "btn", L.copy_prompt);
    copy.disabled = busy || task.needsReapproval || !waiting;
    copy.onclick = copyPrompt;
    actions.append(copy);
    if (task.needsReapproval) {
      const reselect = node("button", "btn primary", L.reapprove);
      reselect.disabled = busy;
      reselect.onclick = () => selectTask(task.id);
      actions.append(reselect);
    } else {
      const serve = node("button", "btn primary", L.serve);
      serve.disabled = busy || !task.canServe;
      serve.title = task.canServe ? L.serve_title : L.serve_not_ready;
      serve.onclick = async () => {
        const result = await act("serve", { task: task.id });
        if (result) {
          $("task-dialog").close();
          toast(L.toast_served);
        }
      };
      actions.append(serve);
    }
  } else if (task.column !== "done") {
    const select = node("button", "btn primary", L.select);
    select.disabled = busy || !!task.reason;
    select.onclick = () => selectTask(task.id);
    actions.append(select);
  } else actions.append(node("span", "chip", L.served));
}
async function selectTask(id) {
  const result = await act("select", { task: id });
  if (result) {
    renderTask();
    toast(L.toast_selected);
    await loadPrompt();
  }
}
async function loadPrompt() {
  const result = await act("prompt", { task: taskId });
  if (result) $("prompt").value = result.prompt;
  return result;
}
async function refreshChat() {
  const requested = chatStation;
  try {
    const received = await request(
      "/api/chat" + (chatStation ? "?station=" + encodeURIComponent(chatStation) : ""),
    );
    if (requested !== chatStation) return;
    chat = received;
    renderChat();
  } catch (error) {
    $("chat-note").textContent = error.message;
  }
}
function renderChat() {
  if (!chat) return;
  const log = $("chat-log");
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.replaceChildren(
    ...(chat.lines.length
      ? chat.lines.map((l) => node("div", "chat-line " + l.role, l.text))
      : [node("div", "chat-empty", L.chat_empty)]),
  );
  if (atBottom) log.scrollTop = log.scrollHeight;
  const sel = $("chat-provider");
  if (sel.dataset.list !== chat.providers.join()) {
    sel.replaceChildren(
      ...chat.providers.map((p) => {
        const o = node("option", "", p);
        o.value = p;
        return o;
      }),
    );
    sel.dataset.list = chat.providers.join();
  }
  const want = chat.locked || chat.provider;
  if (want) sel.value = want;
  sel.disabled = !!chat.locked || chat.running;
  $("chat-send").disabled = busy || chat.running;
  $("chat-stop").disabled = !chat.running;
  $("chat-note").textContent = chat.running
    ? L.chat_running
    : chat.locked
      ? L.chat_locked
      : L.chat_rules;
}
async function sendChat() {
  const requested = chatStation;
  const text = $("chat-input").value;
  if (!text.trim()) {
    toast(L.chat_type_first, true);
    return;
  }
  $("chat-send").disabled = true;
  try {
    const received = await request("/api/action", {
      action: "chat",
      station: requested,
      text,
      provider: $("chat-provider").value,
    });
    chatDrafts.delete(requested);
    if (requested !== chatStation) return;
    chat = received;
    $("chat-input").value = "";
    renderChat();
  } catch (error) {
    toast(error.message, true);
    await refreshChat();
  }
}
async function stopChat() {
  const requested = chatStation;
  try {
    const received = await request("/api/action", { action: "chat-stop", station: requested });
    if (requested !== chatStation) return;
    chat = received;
    renderChat();
  } catch (error) {
    toast(error.message, true);
  }
}
$("chat-station").onchange = () => {
  chatDrafts.set(chatStation, $("chat-input").value);
  chatStation = $("chat-station").value;
  $("chat-input").value = chatDrafts.get(chatStation) || "";
  chat = null;
  refreshChat();
};
$("chat-send").onclick = sendChat;
$("chat-stop").onclick = stopChat;
$("chat-input").onkeydown = (e) => {
  // Enter sends, Shift+Enter breaks the line; never while an input method is composing a letter.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    sendChat();
  }
};
setInterval(() => {
  if (!$("chat-box").hidden) refreshChat();
}, 1500);
$("sign-btn").onclick = async () => {
  const result = await act("sign");
  if (result) toast(L.toast_signed);
};
async function copyPrompt() {
  const result = await loadPrompt();
  if (!result) return;
  try {
    await navigator.clipboard.writeText(result.prompt);
    toast(L.toast_copied);
  } catch {
    $("prompt").hidden = false;
    $("prompt").focus();
    $("prompt").select();
    toast(L.toast_copy_manual);
  }
}
function openDocs(kind = "spec") {
  docKind = kind;
  updateEditor();
  if (!$("docs-dialog").open) $("docs-dialog").showModal();
}
function updateEditor() {
  $("editor").value = board[docKind] || "";
  $("spec-tab").classList.toggle("primary", docKind === "spec");
  $("plan-tab").classList.toggle("primary", docKind === "plan");
  $("doc-help").textContent = L.doc_read_only;
}
$("docs-btn").onclick = () => openDocs();
$("spec-tab").onclick = () => openDocs("spec");
$("plan-tab").onclick = () => openDocs("plan");
async function split() {
  const result = await act("split");
  if (result) {
    toast(L.toast_split);
  }
}
$("split-btn").onclick = split;
$("welcome-btn").onclick = () =>
  board.plan ? openDocs("plan") : board.spec ? split() : openDocs();
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
document.querySelectorAll("[data-filter]").forEach(
  (b) =>
    (b.onclick = () => {
      filter = b.dataset.filter;
      document
        .querySelectorAll("[data-filter]")
        .forEach((t) => t.classList.toggle("active", t === b));
      render();
    }),
);
$("search").oninput = (e) => {
  query = e.target.value.trim().toLocaleLowerCase();
  render();
};
function showTab(name) {
  $("work").dataset.tab = name;
  document.querySelectorAll("[data-tab-btn]").forEach((b) => {
    const on = b.dataset.tabBtn === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
  if (name === "chat") $("chat-input").focus({ preventScroll: true });
}
document
  .querySelectorAll("[data-tab-btn]")
  .forEach((b) => (b.onclick = () => showTab(b.dataset.tabBtn)));
function showView(view) {
  document.body.dataset.view = view;
  document
    .querySelectorAll("button[data-view]")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
  try {
    localStorage.setItem("verid-view", view);
  } catch {}
}
document
  .querySelectorAll("button[data-view]")
  .forEach((b) => (b.onclick = () => showView(b.dataset.view)));
let savedView = "split";
try {
  savedView = localStorage.getItem("verid-view") || "split";
} catch {}
showView($("kitchen") ? savedView : "work");
refresh();
setInterval(async () => {
  if (!busy && !dragId && !$("docs-dialog").open) {
    await refresh();
    if ($("task-dialog").open) renderTask();
  }
}, 4000);
