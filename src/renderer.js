import {
  GRID,
  BUILTINS,
  annotationPalette,
  clone,
  chipBoundingBox,
  descriptorForInstance,
  getPin,
  instancePinPosition,
  annotationBoundingBox,
  rootPinPosition,
  rotatePoint
} from "./model.js";
import { disconnected, isHigh, stateLabel } from "./simulation.js";

const TAU = Math.PI * 2;
const GRID_COLOURS = Object.freeze({
  background: "#202124",
  line: "#2b2e33",
  highlight: "#353940"
});

function rgba(hex, alpha = 1) {
  const value = hex.replace("#", "");
  const number = Number.parseInt(value.length === 3 ? value.split("").map((c) => c + c).join("") : value, 16);
  return `rgba(${number >> 16}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

function darken(hex, factor = .72) {
  const value = String(hex || "").replace("#", "");
  const expanded = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return "#34445a";
  const number = Number.parseInt(expanded, 16);
  const channel = (shift) => Math.round(((number >> shift) & 255) * factor).toString(16).padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

function chipCaptionAnchor(description, width) {
  if (description?.kind === "input") return { x: -width / 6, y: 0 };
  if (description?.special !== "logicGate") return { x: 0, y: 0 };
  if (["not", "buffer"].includes(description.gate)) return { x: -width * .207, y: 0 };
  if (["or", "nor", "xor", "xnor"].includes(description.gate)) return { x: -width * .118, y: 0 };
  if (["and", "nand"].includes(description.gate)) return { x: -width * .026, y: 0 };
  return { x: 0, y: 0 };
}

function distToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(point.x - x, point.y - y);
}

export class WorldRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const box = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, box.width);
    this.height = Math.max(1, box.height);
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.draw(this.lastProject, this.lastSimulator, this.lastState);
  }

  toWorld(screenX, screenY) {
    return { x: (screenX - this.width / 2) / this.camera.zoom + this.camera.x, y: (screenY - this.height / 2) / this.camera.zoom + this.camera.y };
  }

  toScreen(world) {
    return { x: (world.x - this.camera.x) * this.camera.zoom + this.width / 2, y: (world.y - this.camera.y) * this.camera.zoom + this.height / 2 };
  }

  zoomAt(screenX, screenY, factor) {
    const before = this.toWorld(screenX, screenY);
    this.camera.zoom = Math.max(0.1, Math.min(8, this.camera.zoom * factor));
    const after = this.toWorld(screenX, screenY);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
  }

  fit(project, margin = 80) {
    const instances = project.root.instances ?? [];
    const interfacePoints = [...(project.root.inputPins ?? []), ...(project.root.outputPins ?? [])].map((pin) => rootPinPosition(project.root, pin));
    const annotationBoxes = (project.root.annotations ?? []).map(annotationBoundingBox);
    if (!instances.length && !interfacePoints.length && !annotationBoxes.length) {
      this.camera = { x: 0, y: 0, zoom: 1 };
      return;
    }
    const boxes = [...instances.map((item) => chipBoundingBox(project, item)), ...annotationBoxes];
    const minX = Math.min(...boxes.map((b) => b.x), ...interfacePoints.map((p) => p.x - 20));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w), ...interfacePoints.map((p) => p.x + 20));
    const minY = Math.min(...boxes.map((b) => b.y), ...interfacePoints.map((p) => p.y - 20));
    const maxY = Math.max(...boxes.map((b) => b.y + b.h), ...interfacePoints.map((p) => p.y + 20));
    const w = Math.max(100, maxX - minX);
    const h = Math.max(100, maxY - minY);
    this.camera = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: Math.min((this.width - margin) / w, (this.height - margin) / h, 1.4) };
  }

  draw(project, simulator, editorState = {}) {
    this.lastProject = project;
    this.lastSimulator = simulator;
    this.lastState = editorState;
    if (!project || !this.ctx) return;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = GRID_COLOURS.background;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);
    const forceGrid = Boolean(editorState.pointer?.ctrlKey || editorState.pointer?.metaKey) && Boolean(editorState.placement || editorState.drag || editorState.wireStart || editorState.wireEdit);
    this.drawGrid(ctx, project.settings.grid !== false || forceGrid);
    this.drawAnnotations(ctx, project, editorState);
    if (editorState.annotationPlacement) this.drawAnnotationPlacement(ctx, editorState);
    this.drawRootPins(ctx, project, simulator, editorState);
    this.drawWires(ctx, project, simulator, editorState);
    this.drawJunctions(ctx, project, editorState);
    for (const instance of project.root.instances ?? []) this.drawInstance(ctx, project, instance, simulator, editorState);
    if (editorState.placement?.previewItems?.length) this.drawPlacementPreview(ctx, project, editorState);
    if (editorState.wireStart && editorState.mouseWorld) this.drawWirePreview(ctx, project, simulator, editorState);
    if (editorState.selectionBox) this.drawSelectionBox(ctx, editorState.selectionBox);
    ctx.restore();
  }

  drawGrid(ctx, visible) {
    if (!visible) return;
    const left = this.camera.x - this.width / this.camera.zoom / 2 - GRID;
    const right = this.camera.x + this.width / this.camera.zoom / 2 + GRID;
    const top = this.camera.y - this.height / this.camera.zoom / 2 - GRID;
    const bottom = this.camera.y + this.height / this.camera.zoom / 2 + GRID;
    const startX = Math.floor(left / GRID) * GRID;
    const startY = Math.floor(top / GRID) * GRID;
    ctx.lineWidth = 1 / this.camera.zoom;
    for (let x = startX; x <= right; x += GRID) {
      ctx.strokeStyle = Math.round(x / GRID) % 5 === 0 ? GRID_COLOURS.highlight : GRID_COLOURS.line;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    }
    for (let y = startY; y <= bottom; y += GRID) {
      ctx.strokeStyle = Math.round(y / GRID) % 5 === 0 ? GRID_COLOURS.highlight : GRID_COLOURS.line;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    }
  }

  drawWires(ctx, project, simulator, editorState) {
    for (const wire of project.root.wires ?? []) {
      const points = this.wirePoints(project, wire);
      if (points.length < 2) continue;
      const signal = simulator?.stateFor(wire.source) ?? disconnected();
      const colour = signal.tri === 0 ? (isHigh(signal) ? "#7df2a8" : "#7b858f") : "#687279";
      const hovered = editorState.hover?.kind === "wire" && editorState.hover.id === wire.id;
      const target = editorState.wireTarget?.owner === "wire" && editorState.wireTarget?.pin === String(wire.id);
      const editing = editorState.wireEdit?.wireId === wire.id;
      ctx.save();
      ctx.lineCap = editing ? "butt" : "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = (wire.id === editorState.selectedWireId || hovered || target || editing ? 3.2 : signal.tri === 0 ? 2.4 : 1.8) / this.camera.zoom;
      ctx.strokeStyle = target && editorState.wireTargetValid === false ? "#f47883" : target ? "#7df2a8" : hovered || editing ? "#b8d7ff" : colour;
      ctx.globalAlpha = wire.id === editorState.selectedWireId || hovered || target || editing ? 1 : .88;
      ctx.setLineDash(editing ? [10 / this.camera.zoom, 7 / this.camera.zoom] : []);
      ctx.beginPath();
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      if (signal.tri !== 0) {
        ctx.fillStyle = "#687279";
        for (let i = 0; i < points.length - 1; i += 1) {
          const a = points[i]; const b = points[i + 1];
          const t = .5; const x = a.x + (b.x - a.x) * t; const y = a.y + (b.y - a.y) * t;
          ctx.beginPath(); ctx.arc(x, y, 2.6 / this.camera.zoom, 0, TAU); ctx.fill();
        }
      }
      if (wire.id === editorState.selectedWireId || editing) {
        ctx.strokeStyle = "#b8d7ff";
        ctx.lineWidth = 5 / this.camera.zoom;
        ctx.globalAlpha = .25;
        ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
        ctx.globalAlpha = 1;
        for (const [index, point] of (wire.points ?? []).entries()) {
          const pointSelected = editorState.selectedWirePointKeys?.has(`${String(wire.id)}:${index}`);
          const pointHovered = editorState.hover?.kind === "wire-point"
            && editorState.hover.wireId === String(wire.id)
            && editorState.hover.index === index;
          ctx.fillStyle = pointHovered ? "#ffffff" : pointSelected ? "#9bc8ff" : "#b8d7ff";
          ctx.strokeStyle = pointHovered || pointSelected ? "#ffffff" : "#0f1824";
          ctx.lineWidth = ((pointHovered ? 1.6 : pointSelected ? 1.4 : 1)) / this.camera.zoom;
          ctx.beginPath(); ctx.arc(point.x, point.y, (pointHovered ? 6 : pointSelected ? 5 : 4) / this.camera.zoom, 0, TAU); ctx.fill(); ctx.stroke();
          if (!pointHovered && !pointSelected) {
            ctx.fillStyle = "#0f1824";
            ctx.beginPath(); ctx.arc(point.x, point.y, 1.7 / this.camera.zoom, 0, TAU); ctx.fill();
          }
        }
      }
      ctx.restore();
    }
  }

  drawRootPins(ctx, project, simulator, editorState = {}) {
    for (const pin of [...(project.root.inputPins ?? []), ...(project.root.outputPins ?? [])]) {
      const position = rootPinPosition(project.root, pin);
      const signal = simulator?.stateFor({ owner: "root", pin: pin.id }) ?? disconnected();
      const colour = signal.tri === 0 ? (isHigh(signal) ? "#7df2a8" : "#a1a7ab") : "#687279";
      const outward = pin.direction === "input" ? -1 : 1;
      const hovered = editorState.hover?.kind === "pin" && editorState.hover.owner === "root" && editorState.hover.pin === String(pin.id);
      const target = editorState.wireTarget?.owner === "root" && editorState.wireTarget?.pin === String(pin.id);
      ctx.strokeStyle = "#314155"; ctx.lineWidth = 1 / this.camera.zoom;
      ctx.beginPath(); ctx.moveTo(position.x, position.y); ctx.lineTo(position.x + outward * 18, position.y); ctx.stroke();
      ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(position.x, position.y, 4.2, 0, TAU); ctx.fill();
      if (hovered || target) {
        ctx.strokeStyle = target && editorState.wireTargetValid === false ? "#f47883" : target ? "#7df2a8" : "#d7eaff";
        ctx.lineWidth = 2 / this.camera.zoom;
        ctx.beginPath(); ctx.arc(position.x, position.y, 7 / this.camera.zoom, 0, TAU); ctx.stroke();
      }
      if (this.camera.zoom > .62) {
        ctx.fillStyle = "#b2c1d4"; ctx.font = "600 9px JetBrains Mono, Consolas, monospace"; ctx.textBaseline = "middle";
        ctx.textAlign = pin.direction === "input" ? "right" : "left";
        ctx.fillText(`${pin.name}${pin.bits > 1 ? ` [${pin.bits}]` : ""}`, position.x + outward * 25, position.y);
      }
    }
  }

  drawAnnotations(ctx, project, editorState = {}) {
    for (const annotation of project.root.annotations ?? []) {
      const box = annotationBoundingBox(annotation);
      const id = String(annotation.id);
      const selected = editorState.selectedAnnotationIds?.has(id);
      const hovered = editorState.hover?.kind === "annotation" && editorState.hover.id === id;
      const fontSize = Math.max(8, Number(annotation.fontSize) || 11);
      const palette = annotationPalette(annotation.colour || (annotation.type === "label" ? "#f3d36b" : "#d7eaff"));
      const colour = palette.colour;
      ctx.save();
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = `${annotation.type === "label" ? 600 : 500} ${fontSize}px JetBrains Mono, Consolas, monospace`;
      if (annotation.type === "label") {
        ctx.fillStyle = colour;
        ctx.fillText(annotation.text || "Label", box.x, box.y);
      } else {
        ctx.fillStyle = palette.background;
        ctx.globalAlpha = .94;
        ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, 5); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = selected ? "#b8d7ff" : hovered ? "#80bcff" : palette.outline;
        ctx.lineWidth = (selected ? 1.8 : 1) / this.camera.zoom;
        ctx.stroke();
        const paddingX = 12;
        const paddingY = 10;
        this.drawAnnotationText(ctx, annotation.text || "Note", box.x + paddingX, box.y + paddingY, box.w - paddingX * 2, box.h - paddingY * 2, fontSize, colour);
      }
      if (selected || hovered) {
        ctx.strokeStyle = selected ? "#b8d7ff" : "#80bcff";
        ctx.globalAlpha = selected ? .55 : .35;
        ctx.lineWidth = 5 / this.camera.zoom;
        ctx.strokeRect(box.x, box.y, box.w, box.h);
      }
      if (selected && annotation.type === "text") {
        const handleSize = 8 / this.camera.zoom;
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#f5f5f6";
        ctx.strokeStyle = palette.outline;
        ctx.lineWidth = 1 / this.camera.zoom;
        ctx.fillRect(box.x + box.w - handleSize, box.y + box.h - handleSize, handleSize, handleSize);
        ctx.strokeRect(box.x + box.w - handleSize, box.y + box.h - handleSize, handleSize, handleSize);
      }
      ctx.restore();
    }
  }

  drawAnnotationPlacement(ctx, editorState) {
    const placement = editorState.annotationPlacement;
    if (!placement?.position) return;
    const annotation = {
      id: "annotation-preview",
      type: placement.type,
      text: placement.type === "label" ? "Label" : "Note",
      position: placement.position,
      width: placement.width,
      height: placement.height,
      fontSize: 11,
      ...annotationPalette(placement.type === "label" ? "#f3d36b" : "#d7eaff")
    };
    ctx.save();
    ctx.globalAlpha = .58;
    this.drawAnnotations(ctx, { root: { annotations: [annotation] } }, {});
    ctx.restore();
  }

  drawAnnotationText(ctx, text, x, y, width, height, fontSize, colour) {
    const lineHeight = Math.max(12, fontSize * 1.45);
    const maxLines = Math.max(1, Math.floor(height / lineHeight));
    const lines = [];
    for (const paragraph of String(text).split("\n")) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(""); continue; }
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(candidate).width > width) {
          lines.push(line); line = word;
        } else line = candidate;
      }
      if (line) lines.push(line);
    }
    ctx.fillStyle = colour;
    for (let index = 0; index < Math.min(maxLines, lines.length); index += 1) {
      let line = lines[index];
      if (index === maxLines - 1 && lines.length > maxLines) {
        while (line.length && ctx.measureText(`${line}…`).width > width) line = line.slice(0, -1);
        line += "…";
      }
      ctx.fillText(line, x, y + index * lineHeight);
    }
  }

  drawJunctions(ctx, project, editorState = {}) {
    for (const junction of project.root.junctions ?? []) {
      const hovered = editorState.hover?.kind === "junction" && editorState.hover.id === String(junction.id);
      ctx.save();
      ctx.fillStyle = hovered ? "#d7eaff" : "#b8d7ff";
      ctx.beginPath();
      ctx.arc(junction.position.x, junction.position.y, (hovered ? 4 : 3) / this.camera.zoom, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  wirePoints(project, wire, instanceOverride = null, junctionOverride = null) {
    const source = this.endpointPosition(project, wire.source, instanceOverride, junctionOverride);
    const target = this.endpointPosition(project, wire.target, instanceOverride, junctionOverride);
    const points = [source, ...(wire.points ?? []), target];
    return points;
  }

  endpointPosition(project, endpoint, instanceOverride = null, junctionOverride = null) {
    if (String(endpoint.owner) === "wire") return endpoint.position ? { ...endpoint.position } : { x: 0, y: 0 };
    if (String(endpoint.owner) === "junction") {
      const junction = (junctionOverride ?? project.root.junctions ?? []).find((item) => String(item.id) === String(endpoint.pin));
      return junction ? { ...junction.position } : { x: 0, y: 0 };
    }
    if (String(endpoint.owner) === "root") {
      const pin = project.root.inputPins.concat(project.root.outputPins).find((item) => String(item.id) === String(endpoint.pin));
      return pin ? rootPinPosition(project.root, pin) : { x: 0, y: 0 };
    }
    const instance = (instanceOverride ?? project.root.instances).find((item) => String(item.id) === String(endpoint.owner));
    return instance ? instancePinPosition(project, instance, endpoint.pin) : { x: 0, y: 0 };
  }

  drawWirePreview(ctx, project, simulator, editorState) {
    const start = this.endpointPosition(project, editorState.wireStart);
    const route = editorState.wirePoints ?? [];
    const reference = route.length ? route[route.length - 1] : start;
    const mouse = project.settings.straightWires === true || editorState.pointer?.shiftKey
      ? (Math.abs(editorState.mouseWorld.x - reference.x) >= Math.abs(editorState.mouseWorld.y - reference.y)
        ? { x: editorState.mouseWorld.x, y: reference.y }
        : { x: reference.x, y: editorState.mouseWorld.y })
      : editorState.mouseWorld;
    const points = [start, ...route, mouse];
    ctx.save();
    ctx.setLineDash([7 / this.camera.zoom, 5 / this.camera.zoom]);
    ctx.strokeStyle = editorState.wireTargetValid === false ? "#f47883" : editorState.wireTargetValid ? "#7df2a8" : "#b7d9ff";
    ctx.lineWidth = 2 / this.camera.zoom;
    ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
    ctx.restore();
  }

  drawPlacementPreview(ctx, project, editorState) {
    const invalid = editorState.placement?.validity?.valid === false;
    for (const item of editorState.placement.previewItems ?? []) {
      const description = descriptorForInstance(project, item);
      if (!description) continue;
      const box = chipBoundingBox(project, item);
      ctx.save();
      ctx.globalAlpha = .48;
      this.drawChipBody(ctx, project, item, description, false, false, invalid, null);
      ctx.globalAlpha = 1;
      ctx.setLineDash([6 / this.camera.zoom, 4 / this.camera.zoom]);
      ctx.strokeStyle = invalid ? "#f47883" : "#9bc8ff";
      ctx.lineWidth = 1.5 / this.camera.zoom;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.restore();
    }
    for (const wire of editorState.placement.previewWires ?? []) {
      const points = this.wirePoints(project, wire, editorState.placement.previewItems, editorState.placement.previewJunctions);
      ctx.save();
      ctx.setLineDash([6 / this.camera.zoom, 4 / this.camera.zoom]);
      ctx.strokeStyle = invalid ? "#f47883" : "#9bc8ff";
      ctx.lineWidth = 2 / this.camera.zoom;
      ctx.beginPath();
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.stroke();
      ctx.restore();
    }
    for (const junction of editorState.placement.previewJunctions ?? []) {
      ctx.fillStyle = invalid ? "#f47883" : "#9bc8ff";
      ctx.beginPath(); ctx.arc(junction.position.x, junction.position.y, 3 / this.camera.zoom, 0, TAU); ctx.fill();
    }
  }

  drawSelectionBox(ctx, box) {
    if (!box) return;
    const x = Math.min(box.start.x, box.current.x);
    const y = Math.min(box.start.y, box.current.y);
    const w = Math.abs(box.current.x - box.start.x);
    const h = Math.abs(box.current.y - box.start.y);
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, .10)";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1 / this.camera.zoom;
    ctx.setLineDash([5 / this.camera.zoom, 4 / this.camera.zoom]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  drawInstance(ctx, project, instance, simulator, editorState) {
    const description = descriptorForInstance(project, instance);
    if (!description) return;
    const selected = editorState.selectedIds?.has(String(instance.id));
    const hovered = editorState.hover?.kind === "instance" && editorState.hover.id === String(instance.id);
    const invalid = Boolean(editorState.drag?.invalid && selected);
    this.drawChipBody(ctx, project, instance, description, selected, hovered, invalid, simulator);
    this.drawPins(ctx, project, instance, description, simulator, editorState);
  }

  drawChipBody(ctx, project, instance, description, selected, hovered = false, invalid = false, simulator = null) {
    const box = chipBoundingBox(project, instance);
    const rotation = (instance.rotation ?? 0) * Math.PI / 2;
    ctx.save();
    ctx.translate(instance.position.x, instance.position.y);
    ctx.rotate(rotation);
    const w = description.size.x;
    const h = description.size.y;
    const bodyColour = description.colour || "#202b3a";
    const bodyOutline = darken(bodyColour);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (description.kind === "input") {
      const inputPin = description.outputPins?.[0];
      const inputSignal = simulator?.stateFor({ owner: instance.id, pin: inputPin?.id }) ?? project._simSnapshot?.instances?.[instance.id]?.signals?.[String(inputPin?.id)] ?? disconnected();
      const active = description.kind === "input"
        ? Number(project.inputValues?.[instance.id] ?? 0) !== 0
        : inputSignal.tri === 0 && isHigh(inputSignal);
      ctx.fillStyle = active ? "#2f7d54" : "#3a444b";
      ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, 0); ctx.lineTo(-w / 2, h / 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = invalid ? "#f47883" : selected ? "#d8f5e2" : hovered ? "#b8e6c8" : active ? "#5bc783" : "#687279";
      ctx.lineWidth = (selected ? 2.2 : 1.8) / this.camera.zoom; ctx.stroke();
    } else if (description.kind === "output") {
      const outputPin = description.inputPins?.[0];
      const outputSignal = simulator?.stateFor({ owner: instance.id, pin: outputPin?.id }) ?? project._simSnapshot?.instances?.[instance.id]?.signals?.[String(outputPin?.id)] ?? disconnected();
      const active = outputSignal.tri === 0 && isHigh(outputSignal);
      ctx.fillStyle = "#3a444b";
      ctx.strokeStyle = invalid ? "#f47883" : selected ? "#d8f5e2" : hovered ? "#b8e6c8" : "#687279";
      ctx.lineWidth = (selected ? 2.2 : 1.8) / this.camera.zoom;
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = active ? "#7df2a8" : "#687279";
      ctx.beginPath(); ctx.arc(0, 0, Math.min(w, h) * .22, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = bodyColour;
       ctx.strokeStyle = invalid ? "#f47883" : selected ? "#bedcff" : hovered ? "#94c9ff" : bodyOutline;
      ctx.lineWidth = (selected ? 2.2 : hovered ? 2 : 1.8) / this.camera.zoom;
      if (description.special === "logicGate") this.drawLogicGate(ctx, description.gate, w, h);
      else {
        ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 4); ctx.fill(); ctx.stroke();
        this.drawSpecialDisplay(ctx, project, instance, description);
      }
    }
    const captionAnchor = chipCaptionAnchor(description, w);
    this.drawChipCaption(ctx, instance.label || description.name, w, h, hovered, captionAnchor);
    ctx.restore();
    if (selected || hovered || invalid) {
      ctx.save();
      ctx.strokeStyle = invalid ? "#f47883" : "#80bcff"; ctx.globalAlpha = selected || invalid ? .35 : .22; ctx.lineWidth = (invalid ? 6 : 5) / this.camera.zoom;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.restore();
    }
  }

  drawChipCaption(ctx, value, width, height, hovered = false, anchor = { x: 0, y: 0 }) {
    const text = String(value || "CHIP").trim() || "CHIP";
    const available = Math.max(28, width - 12);
    let fontSize = Math.min(12, Math.max(8, height * .22));
    const font = () => { ctx.font = `700 ${fontSize}px JetBrains Mono, Consolas, monospace`; };
    font();
    while (fontSize > 7 && ctx.measureText(text).width > available) {
      fontSize -= .5;
      font();
    }
    let fitted = text;
    if (ctx.measureText(fitted).width > available) {
      fitted = "";
      for (const character of text) {
        if (ctx.measureText(`${fitted}${character}…`).width > available) break;
        fitted += character;
      }
      fitted = `${fitted || text.slice(0, 1)}…`;
    }
    ctx.save();
    ctx.globalAlpha = hovered ? 1 : .36;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0, 0, 0, .65)";
    ctx.shadowBlur = 2;
    ctx.fillText(fitted, anchor.x, anchor.y);
    ctx.restore();
  }

  drawLogicGate(ctx, gate, width, height) {
    const w = width / 2;
    const h = height / 2;
    ctx.beginPath();
    if (gate === "not" || gate === "buffer") {
      ctx.moveTo(-w * .48, -h * .82);
      ctx.lineTo(w * .34, 0);
      ctx.lineTo(-w * .48, h * .82);
      ctx.closePath();
    } else if (["and", "nand"].includes(gate)) {
      ctx.moveTo(-w * .72, -h * .82);
      ctx.lineTo(0, -h * .82);
      ctx.quadraticCurveTo(w * .78, -h * .82, w * .78, 0);
      ctx.quadraticCurveTo(w * .78, h * .82, 0, h * .82);
      ctx.lineTo(-w * .72, h * .82);
      ctx.closePath();
    } else {
      ctx.moveTo(-w * .72, -h * .82);
      ctx.quadraticCurveTo(-w * .08, -h * .68, w * .78, 0);
      ctx.quadraticCurveTo(-w * .08, h * .68, -w * .72, h * .82);
      ctx.quadraticCurveTo(-w * .38, 0, -w * .72, -h * .82);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
    if (gate === "xor" || gate === "xnor") {
      ctx.beginPath();
      ctx.moveTo(-w * .88, -h * .82);
      ctx.quadraticCurveTo(-w * .54, 0, -w * .88, h * .82);
      ctx.stroke();
    }
    if (["not", "nand", "nor", "xnor"].includes(gate)) {
      const bubble = Math.min(w, h) * .13;
      ctx.fillStyle = GRID_COLOURS.background;
      ctx.beginPath(); ctx.arc(w * .88, 0, bubble, 0, TAU); ctx.fill(); ctx.stroke();
    }
  }

  drawSpecialDisplay(ctx, project, instance, description) {
    const snapshot = project._simSnapshot?.instances?.[instance.id];
    const internal = snapshot?.internal ?? instance.internalData ?? {};
    if (description.special === "led") {
      const input = snapshot?.signals?.["0"] ?? disconnected();
      const ledColour = instance.outputPinColours?.display || "#78f1a7";
      ctx.fillStyle = input.tri === 0 && isHigh(input) ? ledColour : "#344455";
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = input.tri === 0 && isHigh(input) ? 14 : 0;
      ctx.beginPath(); ctx.arc(0, 0, Math.min(description.size.x, description.size.y) * .27, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    } else if (description.special === "sevenSegment") {
      const pins = description.inputPins.map((pin) => snapshot?.signals?.[pin.id] ?? disconnected());
      const segments = [pins[0], pins[1], pins[2], pins[3], pins[4], pins[5], pins[6]].map((s) => s.tri === 0 && isHigh(s));
      const halfWidth = description.size.x * .29;
      const halfHeight = description.size.y * .30;
      const thickness = Math.max(2, description.size.x * .032);
      const inset = thickness * .72;
      const lines = [
        [-halfWidth + inset, -halfHeight, halfWidth - inset, -halfHeight],
        [halfWidth, -halfHeight + inset, halfWidth, -inset],
        [halfWidth, inset, halfWidth, halfHeight - inset],
        [-halfWidth + inset, halfHeight, halfWidth - inset, halfHeight],
        [-halfWidth, inset, -halfWidth, halfHeight - inset],
        [-halfWidth, -halfHeight + inset, -halfWidth, -inset],
        [-halfWidth + inset, 0, halfWidth - inset, 0]
      ];
      lines.forEach(([x1, y1, x2, y2], index) => {
        ctx.strokeStyle = segments[index] ? "#f3d36b" : "#3b4850";
        ctx.lineWidth = thickness;
        ctx.lineCap = "butt";
        ctx.lineJoin = "miter";
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      });
    } else if (description.special === "dot") {
      const width = 8; const height = 8; const pixels = internal.display ?? [];
      for (let row = 0; row < height; row += 1) for (let col = 0; col < width; col += 1) {
        const value = pixels[row * width + col];
        ctx.fillStyle = value ? "#76eaa0" : "#273543";
        ctx.fillRect((col - width / 2) * 9 + 4, (row - height / 2) * 9 + 4, 6, 6);
      }
    } else if (description.special === "rgb") {
      const value = internal.display?.[0] ?? 0;
      const colour = `rgb(${(value & 15) * 17}, ${((value >> 4) & 15) * 17}, ${((value >> 8) & 15) * 17})`;
      ctx.fillStyle = colour; ctx.shadowColor = colour; ctx.shadowBlur = 18;
      ctx.fillRect(-description.size.x * .31, -description.size.y * .31, description.size.x * .62, description.size.y * .62); ctx.shadowBlur = 0;
    }
  }

  drawPins(ctx, project, instance, description, simulator, editorState = {}) {
    for (const pin of [...description.inputPins, ...description.outputPins]) {
      const world = instancePinPosition(project, instance, pin.id);
      const local = rotatePoint({ x: pin.x, y: pin.y }, instance.rotation);
      const state = simulator?.stateFor({ owner: instance.id, pin: pin.id }) ?? disconnected();
      const configuredColour = pin.direction === "output" ? instance.outputPinColours?.[String(pin.id)] : null;
      const colour = configuredColour ? (state.tri === 0 ? configuredColour : rgba(configuredColour, .55)) : state.tri === 0 ? (isHigh(state) ? "#7df2a8" : "#a1a7ab") : "#687279";
      const hovered = editorState.hover?.kind === "pin" && editorState.hover.owner === String(instance.id) && editorState.hover.pin === String(pin.id);
      const target = editorState.wireTarget?.owner === String(instance.id) && editorState.wireTarget?.pin === String(pin.id);
      ctx.save();
      ctx.fillStyle = colour; ctx.strokeStyle = "#0b1018"; ctx.lineWidth = 1 / this.camera.zoom;
      ctx.beginPath(); ctx.arc(world.x, world.y, 4.2, 0, TAU); ctx.fill(); ctx.stroke();
      if (hovered || target) {
        ctx.strokeStyle = target && editorState.wireTargetValid === false ? "#f47883" : target ? "#7df2a8" : "#d7eaff";
        ctx.lineWidth = 2 / this.camera.zoom;
        ctx.beginPath(); ctx.arc(world.x, world.y, 7 / this.camera.zoom, 0, TAU); ctx.stroke();
      }
      if (this.camera.zoom > .62) {
        ctx.fillStyle = "#9aaac0"; ctx.font = "9px JetBrains Mono, Consolas, monospace"; ctx.textBaseline = "middle";
        ctx.textAlign = pin.direction === "input" ? "right" : "left";
        const textOffset = pin.direction === "input" ? -8 : 8;
        ctx.fillText(`${pin.name}${pin.bits > 1 ? ` [${pin.bits}]` : ""}`, world.x + (local.x < 0 ? -8 : 8), world.y);
      }
      if (this.camera.zoom > .9 && pin.bits > 1) {
        ctx.textAlign = "center"; ctx.fillStyle = "#75869c"; ctx.font = "8px JetBrains Mono, monospace";
        ctx.fillText(stateLabel(state, pin.bits), world.x + (local.x < 0 ? -27 : 27), world.y - 9);
      }
      ctx.restore();
    }
  }

  findJunction(project, world, radius = 9) {
    for (const junction of project.root.junctions ?? []) {
      if (Math.hypot(junction.position.x - world.x, junction.position.y - world.y) <= radius / this.camera.zoom) return { owner: "junction", pin: String(junction.id), junction: true, bits: junction.bits, direction: "output", position: junction.position };
    }
    return null;
  }

  findPin(project, world, radius = 9) {
    for (const pin of [...(project.root.inputPins ?? []), ...(project.root.outputPins ?? [])]) {
      const position = rootPinPosition(project.root, pin);
      if (Math.hypot(position.x - world.x, position.y - world.y) <= radius / this.camera.zoom) return { owner: "root", pin: String(pin.id), root: true, pinDescription: pin };
    }
    for (const instance of [...(project.root.instances ?? [])].reverse()) {
      const desc = descriptorForInstance(project, instance);
      for (const pin of [...(desc?.inputPins ?? []), ...(desc?.outputPins ?? [])]) {
        const position = instancePinPosition(project, instance, pin.id);
        if (Math.hypot(position.x - world.x, position.y - world.y) <= radius / this.camera.zoom) return { owner: String(instance.id), pin: String(pin.id), instance, pinDescription: pin };
      }
    }
    return null;
  }

  findInstance(project, world) {
    for (const instance of [...(project.root.instances ?? [])].reverse()) {
      const box = chipBoundingBox(project, instance);
      if (world.x >= box.x - 3 && world.x <= box.x + box.w + 3 && world.y >= box.y - 3 && world.y <= box.y + box.h + 3) return instance;
    }
    return null;
  }

  findAnnotation(project, world) {
    for (const annotation of [...(project.root.annotations ?? [])].reverse()) {
      const box = annotationBoundingBox(annotation);
      if (world.x >= box.x && world.x <= box.x + box.w && world.y >= box.y && world.y <= box.y + box.h) return annotation;
    }
    return null;
  }

  findAnnotationResizeHandle(project, world, radius = 10) {
    for (const annotation of [...(project.root.annotations ?? [])].reverse()) {
      if (annotation.type !== "text") continue;
      const box = annotationBoundingBox(annotation);
      const handle = 8 / this.camera.zoom;
      const x = box.x + box.w - handle / 2;
      const y = box.y + box.h - handle / 2;
      if (Math.hypot(world.x - x, world.y - y) <= radius / this.camera.zoom) return annotation;
    }
    return null;
  }

  findWire(project, world, threshold = 7) {
    for (const wire of [...(project.root.wires ?? [])].reverse()) {
      const points = this.wirePoints(project, wire);
      for (let i = 0; i < points.length - 1; i += 1) if (distToSegment(world, points[i], points[i + 1]) <= threshold / this.camera.zoom) return wire;
    }
    return null;
  }

  findWirePoint(project, world, threshold = 10, wireId = null) {
    const wires = wireId == null
      ? [...(project.root.wires ?? [])].reverse()
      : [...(project.root.wires ?? [])].filter((wire) => String(wire.id) === String(wireId));
    for (const wire of wires) {
      for (let index = 0; index < (wire.points ?? []).length; index += 1) {
        const point = wire.points[index];
        if (Math.hypot(point.x - world.x, point.y - world.y) <= threshold / this.camera.zoom) return { wire, index };
      }
    }
    return null;
  }

  closestWireSegment(project, wire, world) {
    const points = this.wirePoints(project, wire);
    let best = { distance: Infinity, index: 0, point: world };
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index]; const b = points[index + 1];
      const dx = b.x - a.x; const dy = b.y - a.y; const length = dx * dx + dy * dy;
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((world.x - a.x) * dx + (world.y - a.y) * dy) / length));
      const point = { x: a.x + t * dx, y: a.y + t * dy };
      const distance = Math.hypot(point.x - world.x, point.y - world.y);
      if (distance < best.distance) best = { distance, index, point };
    }
    return best;
  }
}
