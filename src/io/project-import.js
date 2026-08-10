import { TYPE, instanceFor, isInputType, isOutputType, normalizeProject, uid } from "../model.js";
import { convertUnityChipFile, convertUnityProject } from "../unity-compat.js";

export async function readProjectFile(file) {
  const text = await file.text();
  const raw = JSON.parse(text);
  if (raw?.schema === "digital-logic-sim-web/1" || raw?.root) return normalizeProject(raw);
  if (raw?.schema === "digital-logic-sim-web/chip/1" && raw.description) {
    const root = { ...raw.description, id: "root", inputPins: [], outputPins: [] };
    const hasMovableInterfaceNodes = (root.instances ?? []).some((instance) => isInputType(instance.name) || isOutputType(instance.name));
    if (hasMovableInterfaceNodes) {
      delete root.interfaceBindings;
      delete root.fit;
    }
    const project = normalizeProject({ name: raw.name || root.name || "Imported chip", root, customChips: {} });
    if (!hasMovableInterfaceNodes) exposeImportedChipPins(project);
    return project;
  }
  const unityChip = convertUnityChipFile(raw);
  if (unityChip) {
    const project = normalizeProject({ name: unityChip.name, root: { ...unityChip, id: "root" }, customChips: {} });
    exposeImportedChipPins(project);
    return project;
  }
  if (raw?.ProjectName) return normalizeProject(convertUnityProject(raw));
  throw new Error("The file is not a recognized Digital Logic Sim project or chip description.");
}

function exposeImportedChipPins(project) {
  const root = project.root;
  const endpointMap = new Map();
  const terminal = (pin, input) => {
    const name = input
      ? (pin.bits === 8 ? TYPE.IN_8 : pin.bits === 4 ? TYPE.IN_4 : TYPE.IN_1)
      : (pin.bits === 8 ? TYPE.OUT_8 : pin.bits === 4 ? TYPE.OUT_4 : TYPE.OUT_1);
    const position = { x: (input ? -1 : 1) * (root.size.x / 2 + 35), y: pin.y ?? 0 };
    const instance = instanceFor(name, position);
    instance.id = uid(input ? "imported-in" : "imported-out");
    root.instances.push(instance);
    endpointMap.set(`${pin.id}:${input ? "source" : "target"}`, { owner: instance.id, pin: "0" });
    if (input) project.inputValues[instance.id] = 0;
  };
  for (const pin of root.inputPins) terminal(pin, true);
  for (const pin of root.outputPins) terminal(pin, false);
  root.wires = root.wires.map((wire) => ({
    ...wire,
    source: wire.source.owner === "root" ? endpointMap.get(`${wire.source.pin}:source`) ?? wire.source : wire.source,
    target: wire.target.owner === "root" ? endpointMap.get(`${wire.target.pin}:target`) ?? wire.target : wire.target
  }));
  root.inputPins = [];
  root.outputPins = [];
}
