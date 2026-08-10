import { getDescription } from "../model.js";

export function createLibraryController({ $, escapeHtml, refreshIcons, getProject, getState, collectionGroupsFor, canvas, renderer, beginPlacement, updatePlacementPreview, placeAt, cancelPlacement, closeBottomMenu, render, touch, saveCurrentProject }) {
  function project() { return getProject(); }
  function state() { return getState(); }

  function closeCollectionPopup() {
    const popup = $("#collection-popup");
    if (!popup) return;
    popup.classList.add("hidden");
    popup.innerHTML = "";
  }

  function renderCollectionTabs() {
    const root = $("#collection-tabs");
    if (!root) return;
    root.innerHTML = "";
    for (const group of collectionGroupsFor(project())) {
      const button = document.createElement("button");
      button.className = "collection-tab";
      button.dataset.collection = group.name;
      button.draggable = true;
      button.title = `Open ${group.name}; drag to reorder`;
      const caret = document.createElement("i");
      caret.className = "collection-caret icon-glyph";
      caret.dataset.lucide = "chevron-up";
      caret.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "collection-tab-label";
      label.textContent = group.name;
      const count = document.createElement("span");
      count.className = "collection-tab-count";
      count.textContent = String(group.chips.filter((name) => getDescription(project(), name)).length);
      button.append(caret, label, count);
      root.appendChild(button);
    }
    refreshIcons();
  }

  function renderLibrary() {
    const search = $("#chip-search").value.trim().toLowerCase();
    const root = $("#chip-library");
    root.innerHTML = "";
    for (const group of collectionGroupsFor(project())) {
      const chips = group.chips.filter((name) => name.toLowerCase().includes(search));
      if (!chips.length) continue;
      const section = document.createElement("section");
      section.className = "library-group";
      const heading = document.createElement("div");
      heading.className = "library-group-title";
      heading.textContent = group.name;
      section.appendChild(heading);
      chips.forEach((name) => {
        const desc = getDescription(project(), name);
        if (!desc) return;
        const button = document.createElement("button");
        button.className = "chip-button";
        button.dataset.chip = name;
        const swatch = document.createElement("span");
        swatch.className = "chip-swatch";
        swatch.style.background = desc.colour;
        const label = document.createElement("span");
        label.className = "chip-name";
        label.textContent = name;
        const meta = document.createElement("span");
        meta.className = "chip-meta";
        meta.textContent = `${desc.inputPins.length}/${desc.outputPins.length}`;
        button.append(swatch, label, meta);
        section.appendChild(button);
      });
      root.appendChild(section);
    }
    if (!root.children.length) root.innerHTML = `<div class="empty-inspector">No chips match &quot;${escapeHtml(search)}&quot;.</div>`;
    renderCollectionTabs();
  }

  function positionCollectionPopup(popup, anchor) {
    const margin = 8;
    const menuBox = popup.getBoundingClientRect();
    const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - menuBox.width - margin));
    const preferredTop = anchor.top - menuBox.height - margin;
    const top = preferredTop >= margin
      ? preferredTop
      : Math.min(anchor.bottom + margin, window.innerHeight - menuBox.height - margin);
    popup.style.left = `${left}px`;
    popup.style.top = `${Math.max(margin, top)}px`;
    popup.style.bottom = "auto";
  }

  function toggleCollectionPopup(name, anchor = null) {
    const popup = $("#collection-popup");
    if (!popup.classList.contains("hidden") && popup.dataset.collection === name) {
      closeCollectionPopup();
      return;
    }
    const collection = collectionGroupsFor(project()).find((item) => item.name === name);
    if (!collection) return;
    popup.dataset.collection = name;
    const chips = collection.chips.filter((chip) => getDescription(project(), chip));
    popup.innerHTML = `<div class="collection-popup-header"><span>${escapeHtml(name)}</span><span>${chips.length}</span></div>${chips.length ? chips.map((chip) => {
      const description = getDescription(project(), chip);
      return `<button class="collection-chip" data-chip="${escapeHtml(chip)}"><span class="chip-swatch" style="background:${description.colour}"></span><span>${escapeHtml(chip)}</span><span class="chip-meta">${description.inputPins.length}/${description.outputPins.length}</span></button>`;
    }).join("") : `<div class="collection-popup-empty">No chips saved here.</div>`}`;
    popup.classList.remove("hidden");
    const tab = anchor || [...document.querySelectorAll("#collection-tabs [data-collection]")]
      .find((button) => button.dataset.collection === name)?.getBoundingClientRect();
    if (tab) positionCollectionPopup(popup, tab);
    refreshIcons();
  }

  function beginChipDrag(event) {
    if (event.button !== 0) return;
    const button = event.target.closest("[data-chip]");
    if (!button) return;
    state().chipDrag = {
      pointerId: event.pointerId,
      name: button.dataset.chip,
      button,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    button.setPointerCapture?.(event.pointerId);
  }

  function updateChipDragPreview(event) {
    const drag = state().chipDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.moved) {
      if (distance < 6) return;
      drag.moved = true;
      closeCollectionPopup();
      closeBottomMenu();
      $("#app").classList.remove("library-open");
      beginPlacement(drag.name);
    }
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    state().mouseWorld = renderer.toWorld(event.clientX - rect.left, event.clientY - rect.top);
    updatePlacementPreview(state().mouseWorld);
    render();
  }

  function finishChipDrag(event, cancelled = false) {
    const drag = state().chipDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state().chipDrag = null;
    try { drag.button.releasePointerCapture?.(event.pointerId); } catch {}
    if (!drag.moved) return;
    event.preventDefault();
    state().lastChipDragAt = performance.now();
    if (cancelled || !state().placement) {
      if (state().placement) cancelPlacement();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const insideCanvas = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!insideCanvas) {
      cancelPlacement();
      return;
    }
    state().mouseWorld = renderer.toWorld(event.clientX - rect.left, event.clientY - rect.top);
    updatePlacementPreview(state().mouseWorld);
    placeAt(state().mouseWorld);
  }

  function beginChipPlacement(name) {
    closeCollectionPopup();
    closeBottomMenu();
    $("#app").classList.remove("library-open");
    beginPlacement(name);
  }

  function handleChipClick(event) {
    const button = event.target.closest("[data-chip]");
    if (!button) return;
    if (performance.now() - state().lastChipDragAt < 300) {
      state().lastChipDragAt = 0;
      event.preventDefault();
      return;
    }
    beginChipPlacement(button.dataset.chip);
  }

  function reorderCollectionTabs(sourceName, targetName) {
    if (!sourceName || !targetName || sourceName === targetName) return;
    const names = collectionGroupsFor(project()).map((group) => group.name);
    const sourceIndex = names.indexOf(sourceName);
    const targetIndex = names.indexOf(targetName);
    if (sourceIndex < 0 || targetIndex < 0) return;
    names.splice(sourceIndex, 1);
    names.splice(names.indexOf(targetName), 0, sourceName);
    project().collectionOrder = names;
    touch("Chip group order updated.", false);
    renderCollectionTabs();
    render();
    void saveCurrentProject({ quiet: true });
  }

  function bind() {
    $("#chip-library").addEventListener("pointerdown", beginChipDrag);
    $("#chip-library").addEventListener("click", handleChipClick);
    $("#collection-tabs").addEventListener("click", (event) => {
      const tab = event.target.closest("[data-collection]");
      if (!tab) return;
      if (performance.now() - state().lastCollectionDragAt < 300) {
        state().lastCollectionDragAt = 0;
        event.preventDefault();
        return;
      }
      toggleCollectionPopup(tab.dataset.collection, tab.getBoundingClientRect());
    });
    $("#collection-tabs").addEventListener("dragstart", (event) => {
      const tab = event.target.closest("[data-collection]");
      if (!tab) return;
      state().collectionDragName = tab.dataset.collection;
      tab.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", state().collectionDragName);
    });
    $("#collection-tabs").addEventListener("dragover", (event) => {
      const tab = event.target.closest("[data-collection]");
      if (!tab || !state().collectionDragName || tab.dataset.collection === state().collectionDragName) return;
      event.preventDefault();
      for (const item of $("#collection-tabs").querySelectorAll(".drag-over")) item.classList.remove("drag-over");
      tab.classList.add("drag-over");
    });
    $("#collection-tabs").addEventListener("drop", (event) => {
      const tab = event.target.closest("[data-collection]");
      if (!tab) return;
      event.preventDefault();
      reorderCollectionTabs(state().collectionDragName || event.dataTransfer.getData("text/plain"), tab.dataset.collection);
      state().lastCollectionDragAt = performance.now();
      state().collectionDragName = null;
    });
    $("#collection-tabs").addEventListener("dragend", () => {
      state().lastCollectionDragAt = performance.now();
      state().collectionDragName = null;
      for (const tab of $("#collection-tabs").querySelectorAll(".dragging, .drag-over")) tab.classList.remove("dragging", "drag-over");
    });
    $("#collection-popup").addEventListener("pointerdown", beginChipDrag);
    $("#collection-popup").addEventListener("click", handleChipClick);
    $("#chip-search").addEventListener("input", renderLibrary);
  }

  return { bind, renderLibrary, closeCollectionPopup, toggleCollectionPopup, updateChipDragPreview, finishChipDrag };
}
