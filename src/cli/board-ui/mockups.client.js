let mockupView = false,
  mockupKey = "";
function showMockups(show) {
  mockupView = show;
  renderTask();
}
$("details-tab").onclick = () => showMockups(false);
$("mockup-tab").onclick = () => showMockups(true);
for (const tab of [$("details-tab"), $("mockup-tab")])
  tab.onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || $("mockup-tab").hidden)
      return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? $("details-tab")
        : event.key === "End"
          ? $("mockup-tab")
          : tab === $("details-tab")
            ? $("mockup-tab")
            : $("details-tab");
    next.focus();
    showMockups(next === $("mockup-tab"));
  };
function renderMockups(task) {
  const available = task.mockups.files.length > 0;
  $("mockup-tab").hidden = !available && !mockupView;
  for (const [id, active] of [
    ["mockup-tab", mockupView],
    ["details-tab", !mockupView],
  ]) {
    $(id).setAttribute("aria-selected", String(active));
    $(id).tabIndex = active ? 0 : -1;
  }
  $("task-details").hidden = mockupView;
  $("mockup-panel").hidden = !mockupView;
  if (!mockupView) return;
  const root = $("mockup-panel"),
    key = JSON.stringify([task.id, task.mockups.files]);
  if (mockupKey !== key) {
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    const drafts = new Map();
    if (root.dataset.module === task.id)
      for (const row of root.querySelectorAll(".mockup-option")) {
        const note = row.querySelector("input");
        if (note.value !== note.dataset.saved) drafts.set(row.dataset.choice, note.value);
      }
    mockupKey = key;
    root.dataset.module = task.id;
    root.replaceChildren();
    if (!available) {
      const empty = node("p", "mockup-empty", L.mockup_empty);
      empty.setAttribute("role", "status");
      root.append(empty);
    } else root.append(node("p", "mockup-intro", L.mockup_intro));
    for (const file of task.mockups.files) {
      const choice = file.slice(0, -5),
        row = node("section", "mockup-option");
      row.dataset.choice = choice;
      const heading = node("div", "mockup-heading"),
        title = node("h3", "", choice),
        selected = node("span", "mockup-selected");
      title.id = "mockup-title-" + root.children.length;
      row.setAttribute("aria-labelledby", title.id);
      selected.setAttribute("role", "status");
      heading.append(title, selected);
      row.append(heading);
      const preview = node("div", "mockup-preview"),
        placeholder = node("div", "mockup-placeholder");
      preview.tabIndex = -1;
      const loadStatus = node("p", "mockup-load-status"),
        retry = node("button", "btn", L.mockup_retry);
      loadStatus.setAttribute("role", "status");
      retry.setAttribute("aria-label", fmt("mockup_retry_aria", { choice }));
      placeholder.append(loadStatus, retry);
      const frame = node("iframe");
      frame.title = fmt("mockup_preview", { choice });
      frame.setAttribute("sandbox", "allow-scripts");
      frame.referrerPolicy = "no-referrer";
      frame.hidden = true;
      preview.append(frame, placeholder);
      row.append(preview);
      const loadPreview = () => {
        frame.hidden = true;
        placeholder.hidden = false;
        loadStatus.textContent = L.mockup_loading;
        loadStatus.dataset.error = "false";
        retry.hidden = true;
        preview.setAttribute("aria-busy", "true");
        const failed = () => {
          if (!row.isConnected) return;
          preview.setAttribute("aria-busy", "false");
          loadStatus.textContent = L.mockup_load_error;
          loadStatus.dataset.error = "true";
          retry.hidden = false;
          retry.disabled = busy;
        };
        frame.onload = () => {
          if (!frame.getAttribute("src") || !row.isConnected) return;
          preview.setAttribute("aria-busy", "false");
          frame.hidden = false;
          placeholder.hidden = true;
          if (document.activeElement === preview) frame.focus();
        };
        frame.onerror = failed;
        request("/api/action", {
          action: "mockup-token",
          module: task.id,
          file,
          revision: board.revision,
        })
          .then((result) => {
            if (row.isConnected) frame.src = result.url;
          })
          .catch(failed);
      };
      retry.onclick = () => {
        loadPreview();
        preview.focus();
      };
      const label = node("label", "", L.mockup_note),
        note = node("input");
      note.type = "text";
      note.maxLength = 1000;
      note.setAttribute("aria-label", fmt("mockup_note_aria", { choice }));
      const saved = task.mockups.choice?.choice === choice ? task.mockups.choice.note : "";
      note.value = drafts.get(choice) ?? saved;
      note.dataset.saved = saved;
      label.append(note);
      const saveStatus = node("p", "mockup-save-status");
      saveStatus.setAttribute("role", "status");
      const select = node("button", "btn mockup-choose");
      select.onclick = async () => {
        if (busy) return;
        row.dataset.saving = "true";
        saveStatus.dataset.error = "false";
        saveStatus.textContent = L.mockup_saving;
        const result = await act("mockup-choice", { module: task.id, choice, note: note.value });
        row.dataset.saving = "false";
        if (!row.isConnected) return;
        saveStatus.dataset.error = String(!result);
        saveStatus.textContent = result ? L.mockup_saved : L.mockup_save_error;
        renderTask();
        if (result) toast(L.mockup_saved);
      };
      row.append(label, select, saveStatus);
      root.append(row);
      loadPreview();
    }
    if (focused) $("mockup-tab").focus();
  }
  for (const row of root.querySelectorAll(".mockup-option")) {
    const chosen = task.mockups.choice?.choice === row.dataset.choice,
      note = row.querySelector("input");
    const saved = chosen ? task.mockups.choice.note : "";
    if (note.value === note.dataset.saved) note.value = saved;
    note.dataset.saved = saved;
    note.disabled = busy;
    row.dataset.selected = String(chosen);
    row.querySelector(".mockup-selected").textContent = chosen ? L.mockup_selected : "";
    const select = row.querySelector(".mockup-choose");
    select.disabled = busy;
    select.textContent =
      row.dataset.saving === "true"
        ? L.mockup_saving
        : chosen
          ? L.mockup_save_note
          : L.mockup_choose;
    select.setAttribute(
      "aria-label",
      fmt(chosen ? "mockup_save_note_aria" : "mockup_choose_aria", { choice: row.dataset.choice }),
    );
    row.querySelector(".mockup-placeholder button").disabled = busy;
  }
}
