import {
  GRID,
  BUILTINS,
  annotationPalette,
  clone,
  chipBoundingBox,
  descriptorForInstance,
  getPin,
  interfaceBindingsFor,
  instancePinPosition,
  annotationBoundingBox,
  chipBoundsSize,
  chipVisualSize,
  reusableFitBounds,
  reusablePoint,
  rootPinPosition,
  rotatePoint
} from "./model.js";
import { disconnected, isHigh, stateLabel } from "./simulation.js";

const TAU = Math.PI * 2;
const GRID_COLOURS = Object.freeze({
  background: "#242629",
  line: "#2b2e33",
  highlight: "#353940"
});
// Follow every finite custom-chip nesting level. The cycle guard in
// drawXrayInstance is the recursion boundary; per-level instance and wire
// budgets still keep large projections from overwhelming the canvas.
const XRAY_RECURSION_DEPTH = Number.POSITIVE_INFINITY;
const XRAY_MAX_INSTANCES = 160;
const XRAY_MAX_WIRES = 240;
const CANVAS_STROKE_SCALE = 2;
const CANVAS_WIRE_SCALE = .75;
const MIN_VIEWPORT_STROKE = 1;
export const GRID_MINOR_MIN_SCREEN_SPACING = 8;

export function isMinorGridVisible(zoom = 1) {
  return Number(zoom) * GRID >= GRID_MINOR_MIN_SCREEN_SPACING;
}

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

function signalColour(signal, { high = "#7df2a8", low = "#7b858f", floating = "#687279" } = {}) {
  if (signal?.tri === 0) return isHigh(signal) ? high : low;
  return floating;
}

// The canvas is drawn in world coordinates. Keep the authored width in that
// space and only raise it enough to remain visible as a one-pixel viewport
// stroke when zoomed far out.
function worldStroke(width, zoom = 1) {
  const safeWidth = Number.isFinite(Number(width)) ? Math.max(0, Number(width)) : 0;
  const safeZoom = Number.isFinite(Number(zoom)) ? Math.max(.1, Number(zoom)) : 1;
  return Math.max(safeWidth, MIN_VIEWPORT_STROKE / safeZoom);
}

export function canvasStroke(width, zoom = 1) {
  return worldStroke(Number(width) * CANVAS_STROKE_SCALE, zoom);
}

export function wireStroke(width, zoom = 1) {
  return worldStroke(Number(width) * CANVAS_STROKE_SCALE * CANVAS_WIRE_SCALE, zoom);
}

function traceWirePath(ctx, points, { rounded = false, radius = 0 } = {}) {
  if (!points?.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (!rounded || points.length < 3) {
    for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
    return;
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const incomingX = current.x - previous.x;
    const incomingY = current.y - previous.y;
    const outgoingX = next.x - current.x;
    const outgoingY = next.y - current.y;
    const incomingLength = Math.hypot(incomingX, incomingY);
    const outgoingLength = Math.hypot(outgoingX, outgoingY);
    const corner = Math.min(radius, incomingLength / 2, outgoingLength / 2);
    if (!(corner > 0) || !Number.isFinite(corner)) {
      ctx.lineTo(current.x, current.y);
      continue;
    }
    const before = { x: current.x - incomingX / incomingLength * corner, y: current.y - incomingY / incomingLength * corner };
    const after = { x: current.x + outgoingX / outgoingLength * corner, y: current.y + outgoingY / outgoingLength * corner };
    ctx.lineTo(before.x, before.y);
    ctx.quadraticCurveTo(current.x, current.y, after.x, after.y);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

function traceRoundedPolygon(ctx, vertices, radius = 0) {
  if (!vertices?.length) return;
  if (vertices.length < 3 || !(radius > 0)) {
    ctx.beginPath();
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let index = 1; index < vertices.length; index += 1) ctx.lineTo(vertices[index].x, vertices[index].y);
    ctx.closePath();
    return;
  }
  const corners = vertices.map((vertex, index) => {
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    const next = vertices[(index + 1) % vertices.length];
    const previousLength = Math.hypot(vertex.x - previous.x, vertex.y - previous.y);
    const nextLength = Math.hypot(next.x - vertex.x, next.y - vertex.y);
    const distance = Math.min(radius, previousLength / 2, nextLength / 2);
    return {
      vertex,
      entry: { x: vertex.x + (previous.x - vertex.x) / previousLength * distance, y: vertex.y + (previous.y - vertex.y) / previousLength * distance },
      exit: { x: vertex.x + (next.x - vertex.x) / nextLength * distance, y: vertex.y + (next.y - vertex.y) / nextLength * distance }
    };
  });
  ctx.beginPath();
  ctx.moveTo(corners[0].entry.x, corners[0].entry.y);
  for (const [index, corner] of corners.entries()) {
    ctx.quadraticCurveTo(corner.vertex.x, corner.vertex.y, corner.exit.x, corner.exit.y);
    const next = corners[(index + 1) % corners.length];
    ctx.lineTo(next.entry.x, next.entry.y);
  }
  ctx.closePath();
}

function wrapCaptionLines(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      if (lines.length) lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      if (ctx.measureText(word).width <= maxWidth) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(candidate).width > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      let chunk = "";
      for (const character of word) {
        if (chunk && ctx.measureText(`${chunk}${character}`).width > maxWidth) {
          lines.push(chunk);
          chunk = "";
        }
        chunk += character;
      }
      line = chunk;
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : ["CHIP"];
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

function boundsForPoints(points = []) {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export class WorldRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.geometryCache = null;
    this.geometryCaches = new Map();
    this.geometryCacheHits = 0;
    this.geometryCacheMisses = 0;
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

  invalidateGeometry() {
    this.geometryCache = null;
    this.geometryCaches.clear();
  }

  get performanceStats() {
    return {
      geometryCacheHits: this.geometryCacheHits,
      geometryCacheMisses: this.geometryCacheMisses,
      geometryObjects: this.geometryCache?.instances.length ?? 0,
      geometryWires: this.geometryCache?.wires.length ?? 0
    };
  }

  worldViewport(padding = 48) {
    const zoom = Math.max(.1, this.camera.zoom);
    const margin = padding / zoom;
    return {
      x: this.camera.x - this.width / zoom / 2 - margin,
      y: this.camera.y - this.height / zoom / 2 - margin,
      w: this.width / zoom + margin * 2,
      h: this.height / zoom + margin * 2
    };
  }

  boxVisible(box, viewport = this.worldViewport()) {
    return Boolean(box && box.x <= viewport.x + viewport.w && box.x + box.w >= viewport.x
      && box.y <= viewport.y + viewport.h && box.y + box.h >= viewport.y);
  }

  geometryFor(project, { rawDescriptionPins = false } = {}) {
    const root = project?.root;
    if (!root) return { instances: [], annotations: [], wires: [], junctions: [], rootPins: [], wireById: new Map() };
    const cacheKey = `${project._revision}:${rawDescriptionPins ? "raw" : "normal"}`;
    const rootCaches = this.geometryCaches.get(root) ?? new Map();
    const cached = rootCaches.get(cacheKey);
    if (cached) {
      this.geometryCacheHits += 1;
      this.geometryCache = cached.geometry;
      return cached.geometry;
    }
    this.geometryCacheMisses += 1;
    const instances = (root.instances ?? []).map((instance) => {
      const description = descriptorForInstance(project, instance);
      const pins = [...(description?.inputPins ?? []), ...(description?.outputPins ?? [])].map((pin) => ({
        pin,
        position: instancePinPosition(project, instance, pin.id)
      }));
      return { instance, description, box: chipBoundingBox(project, instance), pins };
    });
    const annotations = (root.annotations ?? []).map((annotation) => ({ annotation, box: annotationBoundingBox(annotation) }));
    const wires = (root.wires ?? []).map((wire) => {
      const points = this.wirePoints(project, wire, null, null, { rawDescriptionPins });
      return { wire, points, box: boundsForPoints(points) };
    });
    const junctions = (root.junctions ?? []).map((junction) => ({
      junction,
      box: { x: junction.position.x, y: junction.position.y, w: 0, h: 0 }
    }));
    const rootPins = interfaceBindingsFor(root).length
      ? []
      : [...(root.inputPins ?? []), ...(root.outputPins ?? [])].map((pin) => ({ pin, position: rootPinPosition(root, pin) }));
    const geometry = {
      instances,
      annotations,
      wires,
      junctions,
      rootPins,
      wireById: new Map(wires.map((entry) => [String(entry.wire.id), entry]))
    };
    rootCaches.set(cacheKey, { geometry });
    this.geometryCaches.set(root, rootCaches);
    this.geometryCache = geometry;
    return geometry;
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
    const interfacePoints = interfaceBindingsFor(project.root).length
      ? []
      : [...(project.root.inputPins ?? []), ...(project.root.outputPins ?? [])].map((pin) => rootPinPosition(project.root, pin));
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

  drawEmptyState(ctx, zoom = this.camera.zoom) {
    const iconCenterY = -18;
    const radius = 23;
    const plusHalfSize = 8;
    const labelBaseline = 30;
    const stroke = worldStroke(1, zoom);

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = "#74787d";
    ctx.lineWidth = stroke;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(0, iconCenterY, radius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "#d9d9dc";
    ctx.lineWidth = worldStroke(1.4, zoom);
    ctx.beginPath();
    ctx.moveTo(-plusHalfSize, iconCenterY);
    ctx.lineTo(plusHalfSize, iconCenterY);
    ctx.moveTo(0, iconCenterY - plusHalfSize);
    ctx.lineTo(0, iconCenterY + plusHalfSize);
    ctx.stroke();

    ctx.fillStyle = "#efefef";
    ctx.font = "600 12px JetBrains Mono, Consolas, monospace";
    ctx.fillText("Empty circuit", 0, labelBaseline);
    ctx.restore();
  }

  draw(project, simulator, editorState = {}) {
    this.lastProject = project;
    this.lastSimulator = simulator;
    this.lastState = editorState;
    if (!project || !this.ctx) return;
    if (editorState.drag || editorState.annotationDrag || editorState.annotationResize || editorState.wirePointDrag) this.invalidateGeometry();
    const geometry = this.geometryFor(project);
    const viewport = this.worldViewport();
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
    const hasCanvasContent = geometry.instances.length || geometry.annotations.length || geometry.wires.length || geometry.junctions.length || geometry.rootPins.length;
    if (!hasCanvasContent) this.drawEmptyState(ctx);
    this.drawAnnotations(ctx, project, editorState, geometry, viewport);
    if (editorState.annotationPlacement) this.drawAnnotationPlacement(ctx, editorState);
    this.drawRootPins(ctx, project, simulator, editorState, geometry, viewport);
    this.drawWires(ctx, project, simulator, editorState, geometry, viewport);
    this.drawJunctions(ctx, project, editorState, geometry, viewport);
    for (const entry of geometry.instances) {
      if (this.boxVisible(entry.box, viewport)) this.drawInstance(ctx, project, entry.instance, simulator, editorState);
    }
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
    const minorVisible = isMinorGridVisible(this.camera.zoom);
    // Once the smaller grid fades out, keep the remaining macro grid quiet
    // instead of leaving a single, unexpectedly prominent grid level.
    const macroColour = minorVisible ? GRID_COLOURS.highlight : GRID_COLOURS.line;
    for (let x = startX; x <= right; x += GRID) {
      const major = Math.round(x / GRID) % 5 === 0;
      if (!major && !minorVisible) continue;
      ctx.strokeStyle = major ? macroColour : GRID_COLOURS.line;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    }
    for (let y = startY; y <= bottom; y += GRID) {
      const major = Math.round(y / GRID) % 5 === 0;
      if (!major && !minorVisible) continue;
      ctx.strokeStyle = major ? macroColour : GRID_COLOURS.line;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    }
  }

  drawWires(ctx, project, simulator, editorState, geometry = this.geometryFor(project), viewport = this.worldViewport()) {
    for (const entry of geometry.wires) {
      if (!this.boxVisible(entry.box, viewport)) continue;
      const wire = entry.wire;
      const points = entry.points;
      if (points.length < 2) continue;
      const signal = simulator?.stateFor(wire.source) ?? disconnected();
      const colour = signal.tri === 0 ? (isHigh(signal) ? "#7df2a8" : "#7b858f") : "#687279";
      const hovered = editorState.hover?.kind === "wire" && editorState.hover.id === wire.id;
      const target = editorState.wireTarget?.owner === "wire" && editorState.wireTarget?.pin === String(wire.id);
      const editing = editorState.wireEdit?.wireId === wire.id;
      const previewAlpha = editorState.preview ? .66 : 1;
      ctx.save();
      ctx.lineCap = editing ? "butt" : "round";
      ctx.lineJoin = editing ? "miter" : "round";
      ctx.lineWidth = wireStroke(wire.id === editorState.selectedWireId || hovered || target || editing ? 3.2 : signal.tri === 0 ? 2.4 : 1.8, this.camera.zoom);
      ctx.strokeStyle = target && editorState.wireTargetValid === false ? "#f47883" : target ? "#7df2a8" : hovered || editing ? "#b8d7ff" : colour;
      ctx.globalAlpha = (wire.id === editorState.selectedWireId || hovered || target || editing ? 1 : .88) * previewAlpha;
      ctx.setLineDash(editing ? [10 / this.camera.zoom, 7 / this.camera.zoom] : []);
      traceWirePath(ctx, points, { rounded: !editing, radius: 4 / this.camera.zoom });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      if (wire.id === editorState.selectedWireId || editing) {
        ctx.strokeStyle = "#b8d7ff";
        ctx.lineWidth = wireStroke(5, this.camera.zoom);
        ctx.globalAlpha = .25 * previewAlpha;
        traceWirePath(ctx, points, { rounded: !editing, radius: 4 / this.camera.zoom }); ctx.stroke();
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

  drawRootPins(ctx, project, simulator, editorState = {}, geometry = this.geometryFor(project), viewport = this.worldViewport()) {
    for (const entry of geometry.rootPins) {
      const pin = entry.pin;
      const position = entry.position;
      if (!this.boxVisible({ x: position.x - 28, y: position.y - 10, w: 56, h: 20 }, viewport)) continue;
      ctx.save();
      if (editorState.preview) ctx.globalAlpha = .66;
      const signal = simulator?.stateFor({ owner: "root", pin: pin.id }) ?? disconnected();
      const colour = signal.tri === 0 ? (isHigh(signal) ? "#7df2a8" : "#a1a7ab") : "#687279";
      const outward = pin.direction === "input" ? -1 : 1;
      const hovered = editorState.hover?.kind === "pin" && editorState.hover.owner === "root" && editorState.hover.pin === String(pin.id);
      const target = editorState.wireTarget?.owner === "root" && editorState.wireTarget?.pin === String(pin.id);
      ctx.strokeStyle = "#314155"; ctx.lineWidth = canvasStroke(1, this.camera.zoom);
      ctx.beginPath(); ctx.moveTo(position.x, position.y); ctx.lineTo(position.x + outward * 18, position.y); ctx.stroke();
      ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(position.x, position.y, 4.2, 0, TAU); ctx.fill();
      if (hovered || target) {
        ctx.strokeStyle = target && editorState.wireTargetValid === false ? "#f47883" : target ? "#7df2a8" : "#d7eaff";
        ctx.lineWidth = canvasStroke(2, this.camera.zoom);
        ctx.beginPath(); ctx.arc(position.x, position.y, 7 / this.camera.zoom, 0, TAU); ctx.stroke();
      }
      if (this.camera.zoom > .62) {
        ctx.save();
        ctx.fillStyle = "#ffffff"; ctx.globalAlpha = hovered ? 1 : .36;
        ctx.font = "600 9px JetBrains Mono, Consolas, monospace"; ctx.textBaseline = "middle";
        ctx.textAlign = pin.direction === "input" ? "right" : "left";
        ctx.fillText(`${pin.name}${pin.bits > 1 ? ` [${pin.bits}]` : ""}`, position.x + outward * 25, position.y);
        ctx.restore();
      }
      ctx.restore();
    }
  }

  drawAnnotations(ctx, project, editorState = {}, geometry = this.geometryFor(project), viewport = this.worldViewport()) {
    for (const entry of geometry.annotations) {
      const annotation = entry.annotation;
      const box = entry.box;
      if (!this.boxVisible(box, viewport)) continue;
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
        ctx.lineWidth = canvasStroke(selected ? 1.8 : 1, this.camera.zoom);
        ctx.stroke();
        const paddingX = 12;
        const paddingY = 10;
        this.drawAnnotationText(ctx, annotation.text || "Note", box.x + paddingX, box.y + paddingY, box.w - paddingX * 2, box.h - paddingY * 2, fontSize, colour);
      }
      if (selected || hovered) {
        ctx.strokeStyle = selected ? "#b8d7ff" : "#80bcff";
        ctx.globalAlpha = selected ? .55 : .35;
        ctx.lineWidth = canvasStroke(2.5, this.camera.zoom);
        ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, 4); ctx.stroke();
      }
      if (selected && annotation.type === "text") {
        const handleSize = 8 / this.camera.zoom;
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#f5f5f6";
        ctx.strokeStyle = palette.outline;
        ctx.lineWidth = canvasStroke(1, this.camera.zoom);
        ctx.fillRect(box.x + box.w - handleSize, box.y + box.h - handleSize, handleSize, handleSize);
        ctx.beginPath(); ctx.roundRect(box.x + box.w - handleSize, box.y + box.h - handleSize, handleSize, handleSize, 1.5); ctx.stroke();
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

  drawJunctions(ctx, project, editorState = {}, geometry = this.geometryFor(project), viewport = this.worldViewport()) {
    for (const entry of geometry.junctions) {
      const junction = entry.junction;
      if (!this.boxVisible({ x: junction.position.x - 8, y: junction.position.y - 8, w: 16, h: 16 }, viewport)) continue;
      const hovered = editorState.hover?.kind === "junction" && editorState.hover.id === String(junction.id);
      ctx.save();
      ctx.fillStyle = hovered ? "#d7eaff" : "#b8d7ff";
      ctx.beginPath();
      ctx.arc(junction.position.x, junction.position.y, (hovered ? 4 : 3) / this.camera.zoom, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  wirePoints(project, wire, instanceOverride = null, junctionOverride = null, options = {}) {
    const source = this.endpointPosition(project, wire.source, instanceOverride, junctionOverride, options);
    const target = this.endpointPosition(project, wire.target, instanceOverride, junctionOverride, options);
    const points = [source, ...(wire.points ?? []), target];
    return points;
  }

  endpointPosition(project, endpoint, instanceOverride = null, junctionOverride = null, options = {}) {
    if (String(endpoint.owner) === "wire") return endpoint.position ? { ...endpoint.position } : { x: 0, y: 0 };
    if (String(endpoint.owner) === "junction") {
      const junction = (junctionOverride ?? project.root.junctions ?? []).find((item) => String(item.id) === String(endpoint.pin));
      return junction ? { ...junction.position } : { x: 0, y: 0 };
    }
    if (String(endpoint.owner) === "root") {
      const pin = project.root.inputPins.concat(project.root.outputPins).find((item) => String(item.id) === String(endpoint.pin));
      if (!pin) return { x: 0, y: 0 };
      if (options.rawDescriptionPins) {
        const x = Number(pin.x);
        return { x: Number.isFinite(x) ? x : (pin.direction === "input" ? -project.root.size.x / 2 : project.root.size.x / 2), y: Number(pin.y) || 0 };
      }
      return rootPinPosition(project.root, pin);
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
    ctx.lineWidth = wireStroke(2, this.camera.zoom);
    traceWirePath(ctx, points, { rounded: true, radius: 4 / this.camera.zoom }); ctx.stroke();
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
      ctx.lineWidth = canvasStroke(1.5, this.camera.zoom);
      ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, 4); ctx.stroke();
      ctx.restore();
    }
    for (const wire of editorState.placement.previewWires ?? []) {
      const points = this.wirePoints(project, wire, editorState.placement.previewItems, editorState.placement.previewJunctions);
      ctx.save();
      ctx.setLineDash([6 / this.camera.zoom, 4 / this.camera.zoom]);
      ctx.strokeStyle = invalid ? "#f47883" : "#9bc8ff";
      ctx.lineWidth = wireStroke(2, this.camera.zoom);
      traceWirePath(ctx, points, { rounded: true, radius: 4 / this.camera.zoom });
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
    if (editorState.preview) {
      ctx.save();
      ctx.globalAlpha = .66;
    }
    const selected = editorState.selectedIds?.has(String(instance.id));
    const hovered = editorState.hover?.kind === "instance" && editorState.hover.id === String(instance.id);
    const invalid = Boolean(editorState.drag?.invalid && selected);
    this.drawChipBody(ctx, project, instance, description, selected, hovered, invalid, simulator, editorState.xray ? XRAY_RECURSION_DEPTH : 0, []);
    this.drawPins(ctx, project, instance, description, simulator, editorState);
    if (editorState.preview) ctx.restore();
  }

  drawChipBody(ctx, project, instance, description, selected, hovered = false, invalid = false, simulator = null, xrayDepth = 0, signalScope = []) {
    const box = chipBoundingBox(project, instance);
    const rotation = (instance.rotation ?? 0) * Math.PI / 2;
    ctx.save();
    ctx.translate(instance.position.x, instance.position.y);
    ctx.rotate(rotation);
    const visualSize = chipVisualSize(description);
    const w = visualSize.x;
    const h = visualSize.y;
    const labelBounds = chipBoundsSize(description);
    const bodyColour = description.colour || "#202b3a";
    const bodyOutline = darken(bodyColour);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (description.kind === "input") {
      const inputPin = description.outputPins?.[0];
      const inputSignal = simulator?.stateFor({ owner: instance.id, pin: inputPin?.id }, signalScope) ?? project._simSnapshot?.instances?.[instance.id]?.signals?.[String(inputPin?.id)] ?? disconnected();
      const active = simulator
        ? inputSignal.tri === 0 && isHigh(inputSignal)
        : Number(project.inputValues?.[instance.id] ?? 0) !== 0;
      ctx.fillStyle = active ? "#2f7d54" : "#3a444b";
      traceRoundedPolygon(ctx, [
        { x: -w / 2, y: -h / 2 },
        { x: w / 2, y: 0 },
        { x: -w / 2, y: h / 2 }
      ], Math.min(4, Math.min(w, h) * .08));
      ctx.fill();
      ctx.strokeStyle = invalid ? "#f47883" : selected ? "#d8f5e2" : hovered ? "#b8e6c8" : active ? "#5bc783" : "#687279";
      ctx.lineWidth = canvasStroke(selected ? 2.2 : 1.8, this.camera.zoom); ctx.stroke();
    } else if (description.kind === "output") {
      const outputPin = description.inputPins?.[0];
      const outputSignal = simulator?.stateFor({ owner: instance.id, pin: outputPin?.id }, signalScope) ?? project._simSnapshot?.instances?.[instance.id]?.signals?.[String(outputPin?.id)] ?? disconnected();
      const active = outputSignal.tri === 0 && isHigh(outputSignal);
      ctx.fillStyle = "#3a444b";
      ctx.strokeStyle = invalid ? "#f47883" : selected ? "#d8f5e2" : hovered ? "#b8e6c8" : "#687279";
      ctx.lineWidth = canvasStroke(selected ? 2.2 : 1.8, this.camera.zoom);
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = active ? "#7df2a8" : "#687279";
      ctx.beginPath(); ctx.arc(0, 0, Math.min(w, h) * .22, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = bodyColour;
       ctx.strokeStyle = invalid ? "#f47883" : selected ? "#bedcff" : hovered ? "#94c9ff" : bodyOutline;
      ctx.lineWidth = canvasStroke(selected ? 2.2 : hovered ? 2 : 1.8, this.camera.zoom);
      if (description.special === "logicGate") this.drawLogicGate(ctx, description.gate, w, h);
      else {
        ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 5); ctx.fill(); ctx.stroke();
        this.drawSpecialDisplay(ctx, project, instance, description, simulator, signalScope);
      }
    }
    if (xrayDepth > 0 && description.kind === "custom" && (description.instances ?? []).length) {
      this.drawXrayComposite(ctx, project, description, simulator, xrayDepth, [String(description.name || description.id || "custom")], [...signalScope, String(instance.id)]);
    }
    this.drawChipCaption(ctx, instance.label || description.name, labelBounds.x, labelBounds.y, hovered || selected);
    ctx.restore();
    if (selected || hovered || invalid) {
      ctx.save();
      ctx.strokeStyle = invalid ? "#f47883" : "#80bcff"; ctx.globalAlpha = selected || invalid ? .35 : .22; ctx.lineWidth = worldStroke(invalid ? 6 : 5, this.camera.zoom);
      ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, 4); ctx.stroke();
      ctx.restore();
    }
  }

  drawXrayComposite(ctx, project, description, simulator, depth, path = [], scopePath = []) {
    if (depth <= 0 || !(description.instances ?? []).length) return;
    const visualSize = chipVisualSize(description);
    const fit = reusableFitBounds(description);
    const inset = Math.max(8, Math.min(14, Math.min(visualSize.x, visualSize.y) * .12));
    const frame = {
      x: -visualSize.x / 2 + inset,
      y: -visualSize.y / 2 + inset,
      w: Math.max(16, visualSize.x - inset * 2),
      h: Math.max(16, visualSize.y - inset * 2)
    };
    const scale = Math.min(frame.w / Math.max(1, fit.w), frame.h / Math.max(1, fit.h));
    if (!Number.isFinite(scale) || scale <= 0) return;
    const scopedProject = { ...project, root: description };
    const geometry = this.geometryFor(scopedProject, { rawDescriptionPins: true });
    const previewAlpha = this.lastState?.preview ? .66 : 1;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(frame.x, frame.y, frame.w, frame.h, 3);
    ctx.clip();
    ctx.fillStyle = "rgba(6, 10, 15, .30)";
    ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
    ctx.translate(frame.x + (frame.w - fit.w * scale) / 2 - fit.x * scale, frame.y + (frame.h - fit.h * scale) / 2 - fit.y * scale);
    ctx.scale(scale, scale);
    ctx.globalAlpha = .86 * previewAlpha;
    this.drawXrayWires(ctx, scopedProject, description, simulator, scopePath, geometry);
    const visibleInstances = geometry.instances.slice(0, XRAY_MAX_INSTANCES);
    for (const child of visibleInstances) this.drawXrayInstance(ctx, scopedProject, child.instance, simulator, depth - 1, path, scopePath, child.description);
    this.drawXrayRootPins(ctx, description, simulator, scopePath);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(218, 232, 244, .24)";
    ctx.lineWidth = worldStroke(2, this.camera.zoom);
    ctx.beginPath(); ctx.roundRect(frame.x, frame.y, frame.w, frame.h, 3); ctx.stroke();
    if ((description.instances?.length ?? 0) > XRAY_MAX_INSTANCES) {
      ctx.fillStyle = "rgba(230, 238, 246, .72)";
      ctx.font = "600 8px JetBrains Mono, Consolas, monospace";
      ctx.textAlign = "right"; ctx.textBaseline = "bottom";
      ctx.fillText(`+${description.instances.length - XRAY_MAX_INSTANCES}`, frame.x + frame.w - 5, frame.y + frame.h - 4);
    }
    ctx.restore();
  }

  drawXrayWires(ctx, project, description, simulator = null, scopePath = [], geometry = this.geometryFor(project)) {
    const previewAlpha = this.lastState?.preview ? .66 : 1;
    ctx.save();
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    ctx.lineWidth = worldStroke(3.2 * CANVAS_WIRE_SCALE, this.camera.zoom);
    for (const entry of geometry.wires.slice(0, XRAY_MAX_WIRES)) {
      const wire = entry.wire;
      const points = entry.points;
      if (points.length < 2) continue;
      const signal = simulator?.stateFor(wire.source, scopePath) ?? disconnected();
      ctx.strokeStyle = signalColour(signal);
      ctx.globalAlpha = (signal.tri === 0 ? (isHigh(signal) ? .96 : .74) : .48) * previewAlpha;
      traceWirePath(ctx, points, { rounded: true, radius: 3 });
      ctx.stroke();
    }
    if ((description.wires?.length ?? 0) > XRAY_MAX_WIRES) {
      ctx.fillStyle = "#d7e2eb";
      ctx.font = "600 9px JetBrains Mono, Consolas, monospace";
      ctx.fillText(`+${description.wires.length - XRAY_MAX_WIRES} wires`, reusableFitBounds(description).x, reusableFitBounds(description).y + 12);
    }
    ctx.restore();
  }

  drawXrayInterfaceNode(ctx, project, instance, description, simulator = null, scopePath = []) {
    const isInput = description.kind === "input";
    const pin = (isInput ? description.outputPins : description.inputPins)?.[0];
    if (!pin) return;
    const signal = simulator?.stateFor({ owner: instance.id, pin: pin.id }, scopePath) ?? disconnected();
    const active = signal.tri === 0 && isHigh(signal);
    const pinX = Number.isFinite(Number(pin.x)) ? Number(pin.x) : (isInput ? description.size.x / 2 : -description.size.x / 2);
    const pinY = Number(pin.y) || 0;
    const width = Math.min(28, Math.max(20, chipVisualSize(description).x * .42));
    const height = Math.min(18, Math.max(14, chipVisualSize(description).y * .26));
    const side = isInput ? 1 : -1;
    const label = String(instance.label || (isInput ? "IN" : "OUT")).trim().slice(0, 6) || (isInput ? "IN" : "OUT");
    ctx.save();
    ctx.translate(instance.position.x, instance.position.y);
    ctx.rotate((instance.rotation ?? 0) * Math.PI / 2);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = signalColour(signal, { high: "#5bc783", low: "#687279", floating: "#687279" });
    ctx.lineWidth = worldStroke(2.4, this.camera.zoom);
    ctx.beginPath();
    ctx.moveTo(side * width / 2, 0);
    ctx.lineTo(pinX, pinY);
    ctx.stroke();
    ctx.fillStyle = active ? "#2f7d54" : "#30383e";
    ctx.strokeStyle = active ? "#5bc783" : "#687279";
    ctx.lineWidth = worldStroke(1.2, this.camera.zoom);
    ctx.beginPath();
    ctx.roundRect(-width / 2, -height / 2, width, height, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = .78;
    ctx.font = "700 6px JetBrains Mono, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  drawXrayInstance(ctx, project, instance, simulator, depth, path, scopePath = [], descriptionOverride = null) {
    const description = descriptionOverride ?? descriptorForInstance(project, instance);
    if (!description) return;
    if (description.kind === "input" || description.kind === "output") this.drawXrayInterfaceNode(ctx, project, instance, description, simulator, scopePath);
    else this.drawChipBody(ctx, project, instance, description, false, false, false, simulator, 0, scopePath);
    this.drawXrayPins(ctx, project, instance, description, simulator, scopePath);
    if (description.kind !== "custom" || depth <= 0) return;
    const identity = String(description.name || description.id || instance.name || "custom");
    if (path.includes(identity)) {
      this.drawXrayCycleMarker(ctx, instance, description);
      return;
    }
    ctx.save();
    ctx.translate(instance.position.x, instance.position.y);
    ctx.rotate((instance.rotation ?? 0) * Math.PI / 2);
    this.drawXrayComposite(ctx, project, description, simulator, depth, [...path, identity], [...scopePath, String(instance.id)]);
    ctx.restore();
  }

  drawXrayPins(ctx, project, instance, description, simulator = null, scopePath = []) {
    for (const pin of [...(description.inputPins ?? []), ...(description.outputPins ?? [])]) {
      const position = instancePinPosition(project, instance, pin.id);
      const signal = simulator?.stateFor({ owner: instance.id, pin: pin.id }, scopePath) ?? disconnected();
      ctx.fillStyle = signalColour(signal, {
        high: "#7df2a8",
        low: pin.direction === "output" ? "#9cdab3" : "#c0c8cf",
        floating: "#687279"
      });
      ctx.beginPath(); ctx.arc(position.x, position.y, 2.4, 0, TAU); ctx.fill();
    }
  }

  drawXrayRootPins(ctx, description, simulator = null, scopePath = []) {
    if (interfaceBindingsFor(description).length) return;
    for (const pin of [...(description.inputPins ?? []), ...(description.outputPins ?? [])]) {
      const x = Number(pin.x);
      const position = { x: Number.isFinite(x) ? x : (pin.direction === "input" ? -description.size.x / 2 : description.size.x / 2), y: Number(pin.y) || 0 };
      const signal = simulator?.stateFor({ owner: "root", pin: pin.id }, scopePath) ?? disconnected();
      ctx.fillStyle = signalColour(signal, {
        high: "#7df2a8",
        low: pin.direction === "output" ? "#9cdab3" : "#c0c8cf",
        floating: "#687279"
      });
      ctx.beginPath(); ctx.arc(position.x, position.y, 2.6, 0, TAU); ctx.fill();
    }
  }

  drawXrayCycleMarker(ctx, instance, description) {
    const size = chipVisualSize(description);
    ctx.save();
    ctx.translate(instance.position.x, instance.position.y);
    ctx.fillStyle = "rgba(235, 241, 246, .72)";
    ctx.font = `700 ${Math.max(8, Math.min(12, Math.min(size.x, size.y) * .16))}px JetBrains Mono, Consolas, monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("LOOP", 0, 0);
    ctx.restore();
  }

  drawChipCaption(ctx, value, width, height, hovered = false) {
    const text = String(value || "CHIP").trim() || "CHIP";
    const available = Math.max(32, width - 12);
    let fontSize = Math.min(12, Math.max(8, height * .22));
    let lines = [];
    let lineHeight = fontSize * 1.16;
    for (let candidate = fontSize; candidate >= 7; candidate -= .5) {
      fontSize = candidate;
      ctx.font = `700 ${fontSize}px JetBrains Mono, Consolas, monospace`;
      lines = wrapCaptionLines(ctx, text, available);
      lineHeight = Math.max(9, fontSize * 1.16);
      if (lines.length * lineHeight <= Math.max(18, height - 10) || candidate <= 7) break;
    }
    ctx.save();
    ctx.globalAlpha = hovered ? 1 : .36;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0, 0, 0, .65)";
    ctx.shadowBlur = 2;
    const firstLineY = -((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => ctx.fillText(line, 0, firstLineY + index * lineHeight));
    ctx.restore();
  }

  drawLogicGate(ctx, gate, width, height) {
    const w = width / 2;
    const h = height / 2;
    ctx.beginPath();
    if (gate === "not" || gate === "buffer") {
      ctx.moveTo(-w * .48, -h * .82);
      ctx.lineTo(w * .58, 0);
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
      const bubbleX = ["not", "buffer"].includes(gate) ? w * .72 : w * .76;
      ctx.fillStyle = GRID_COLOURS.background;
      ctx.beginPath(); ctx.arc(bubbleX, 0, bubble, 0, TAU); ctx.fill(); ctx.stroke();
    }
  }

  drawSpecialDisplay(ctx, project, instance, description, simulator = null, scopePath = []) {
    const scopedSnapshot = simulator?.snapshotForScope?.(scopePath);
    const snapshot = scopedSnapshot?.instances?.[String(instance.id)]
      ?? project._simSnapshot?.instances?.[instance.id];
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
        ctx.lineWidth = worldStroke(thickness, this.camera.zoom);
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
    const instanceSelected = editorState.selectedIds?.has(String(instance.id));
    const instanceHovered = editorState.hover?.kind === "instance" && editorState.hover.id === String(instance.id);
    for (const pin of [...description.inputPins, ...description.outputPins]) {
      const world = instancePinPosition(project, instance, pin.id);
      const pinLocal = description.kind === "custom" ? reusablePoint(description, pin) : { x: pin.x, y: pin.y };
      const local = rotatePoint(pinLocal, instance.rotation);
      const state = simulator?.stateFor({ owner: instance.id, pin: pin.id }) ?? disconnected();
      const configuredColour = pin.direction === "output" ? instance.outputPinColours?.[String(pin.id)] : null;
      const colour = configuredColour ? (state.tri === 0 ? configuredColour : rgba(configuredColour, .55)) : state.tri === 0 ? (isHigh(state) ? "#7df2a8" : "#a1a7ab") : "#687279";
      const hovered = editorState.hover?.kind === "pin" && editorState.hover.owner === String(instance.id) && editorState.hover.pin === String(pin.id);
      const target = editorState.wireTarget?.owner === String(instance.id) && editorState.wireTarget?.pin === String(pin.id);
      ctx.save();
      ctx.fillStyle = colour; ctx.strokeStyle = "#0b1018"; ctx.lineWidth = canvasStroke(1, this.camera.zoom);
      ctx.beginPath(); ctx.arc(world.x, world.y, 4.2, 0, TAU); ctx.fill(); ctx.stroke();
      if (hovered || target) {
        ctx.strokeStyle = target && editorState.wireTargetValid === false ? "#f47883" : target ? "#7df2a8" : "#d7eaff";
        ctx.lineWidth = canvasStroke(2, this.camera.zoom);
        ctx.beginPath(); ctx.arc(world.x, world.y, 7 / this.camera.zoom, 0, TAU); ctx.stroke();
      }
      if (this.camera.zoom > .62) {
        const labelEmphasized = instanceSelected || instanceHovered || hovered || target;
        ctx.fillStyle = "#ffffff"; ctx.globalAlpha = labelEmphasized ? 1 : .36;
        ctx.font = "9px JetBrains Mono, Consolas, monospace"; ctx.textBaseline = "middle";
        ctx.textAlign = pin.direction === "input" ? "right" : "left";
        ctx.fillText(`${pin.name}${pin.bits > 1 ? ` [${pin.bits}]` : ""}`, world.x + (local.x < 0 ? -8 : 8), world.y);
        if (this.camera.zoom > .9 && pin.bits > 1) {
          ctx.fillStyle = "#75869c"; ctx.globalAlpha = labelEmphasized ? .9 : .28; ctx.font = "8px JetBrains Mono, monospace"; ctx.textAlign = "center";
          ctx.fillText(stateLabel(state, pin.bits), world.x + (local.x < 0 ? -27 : 27), world.y - 9);
        }
      }
      ctx.restore();
    }
  }

  findJunction(project, world, radius = 9) {
    for (const { junction } of [...this.geometryFor(project).junctions].reverse()) {
      if (Math.hypot(junction.position.x - world.x, junction.position.y - world.y) <= radius / this.camera.zoom) return { owner: "junction", pin: String(junction.id), junction: true, bits: junction.bits, direction: "output", position: junction.position };
    }
    return null;
  }

  findPin(project, world, radius = 9) {
    const geometry = this.geometryFor(project);
    if (geometry.rootPins.length) {
      for (const { pin, position } of geometry.rootPins) {
        if (Math.hypot(position.x - world.x, position.y - world.y) <= radius / this.camera.zoom) return { owner: "root", pin: String(pin.id), root: true, pinDescription: pin };
      }
    }
    for (const entry of [...geometry.instances].reverse()) {
      const instance = entry.instance;
      for (const { pin, position } of entry.pins) {
        if (Math.hypot(position.x - world.x, position.y - world.y) <= radius / this.camera.zoom) return { owner: String(instance.id), pin: String(pin.id), instance, pinDescription: pin };
      }
    }
    return null;
  }

  findInstance(project, world) {
    for (const { instance, box } of [...this.geometryFor(project).instances].reverse()) {
      if (world.x >= box.x - 3 && world.x <= box.x + box.w + 3 && world.y >= box.y - 3 && world.y <= box.y + box.h + 3) return instance;
    }
    return null;
  }

  findAnnotation(project, world) {
    for (const { annotation, box } of [...this.geometryFor(project).annotations].reverse()) {
      if (world.x >= box.x && world.x <= box.x + box.w && world.y >= box.y && world.y <= box.y + box.h) return annotation;
    }
    return null;
  }

  findAnnotationResizeHandle(project, world, radius = 10) {
    for (const { annotation, box } of [...this.geometryFor(project).annotations].reverse()) {
      if (annotation.type !== "text") continue;
      const handle = 8 / this.camera.zoom;
      const x = box.x + box.w - handle / 2;
      const y = box.y + box.h - handle / 2;
      if (Math.hypot(world.x - x, world.y - y) <= radius / this.camera.zoom) return annotation;
    }
    return null;
  }

  findWire(project, world, threshold = 7) {
    const viewport = {
      x: world.x - threshold / this.camera.zoom,
      y: world.y - threshold / this.camera.zoom,
      w: threshold * 2 / this.camera.zoom,
      h: threshold * 2 / this.camera.zoom
    };
    for (const { wire, points, box } of [...this.geometryFor(project).wires].reverse()) {
      if (!this.boxVisible(box, viewport)) continue;
      for (let i = 0; i < points.length - 1; i += 1) if (distToSegment(world, points[i], points[i + 1]) <= threshold / this.camera.zoom) return wire;
    }
    return null;
  }

  findWirePoint(project, world, threshold = 10, wireId = null) {
    const entries = wireId == null
      ? [...this.geometryFor(project).wires].reverse()
      : [...this.geometryFor(project).wires].filter(({ wire }) => String(wire.id) === String(wireId));
    for (const { wire } of entries) {
      for (let index = 0; index < (wire.points ?? []).length; index += 1) {
        const point = wire.points[index];
        if (Math.hypot(point.x - world.x, point.y - world.y) <= threshold / this.camera.zoom) return { wire, index };
      }
    }
    return null;
  }

  closestWireSegment(project, wire, world) {
    const points = this.geometryFor(project).wireById.get(String(wire.id))?.points ?? this.wirePoints(project, wire);
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
