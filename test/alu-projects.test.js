import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeProject } from "../src/model.js";
import { Simulator, isHigh } from "../src/simulation.js";

async function loadProject(file) {
  return normalizeProject(JSON.parse(await readFile(new URL(`../storage/projects/${file}`, import.meta.url), "utf8")));
}

function bit(snapshot, id) {
  return isHigh(snapshot.instances[id]?.signals?.["0"]) ? 1 : 0;
}

test("the saved basic ALU implements its four operations", async () => {
  const project = await loadProject("basic-alu.json");
  const simulator = new Simulator(project);
  for (let a = 0; a < 2; a += 1) for (let b = 0; b < 2; b += 1) for (let cin = 0; cin < 2; cin += 1) for (let op = 0; op < 4; op += 1) {
    project.inputValues["input-a"] = a;
    project.inputValues["input-b"] = b;
    project.inputValues["input-cin"] = cin;
    project.inputValues["input-op0"] = op & 1;
    project.inputValues["input-op1"] = (op >> 1) & 1;
    simulator.step();
    const expectedResult = op === 0 ? a & b : op === 1 ? a | b : op === 2 ? a ^ b : (a + b + cin) & 1;
    const expectedCarry = op === 3 ? Number(a + b + cin > 1) : 0;
    assert.equal(bit(simulator.snapshot, "output-result"), expectedResult, `result ${a},${b},${cin},${op}`);
    assert.equal(bit(simulator.snapshot, "output-carry"), expectedCarry, `carry ${a},${b},${cin},${op}`);
  }
});

test("the saved 4-bit ALU implements operations and flags exhaustively", async () => {
  const project = await loadProject("sophisticated-alu.json");
  const simulator = new Simulator(project);
  for (let a = 0; a < 16; a += 1) for (let b = 0; b < 16; b += 1) for (let cin = 0; cin < 2; cin += 1) for (let op = 0; op < 4; op += 1) {
    project.inputValues["input-a"] = a;
    project.inputValues["input-b"] = b;
    project.inputValues["input-cin"] = cin;
    project.inputValues["input-op0"] = op & 1;
    project.inputValues["input-op1"] = (op >> 1) & 1;
    simulator.step();
    const expectedResult = op === 0 ? a & b : op === 1 ? a | b : op === 2 ? a ^ b : (a + b + cin) & 0xf;
    const signedA = a & 8 ? a - 16 : a;
    const signedB = b & 8 ? b - 16 : b;
    const signedSum = signedA + signedB + cin;
    const expectedCarry = op === 3 ? Number(a + b + cin > 15) : 0;
    const expectedOverflow = op === 3 ? Number(signedSum < -8 || signedSum > 7) : 0;
    assert.equal(simulator.snapshot.instances["output-result"].signals["0"].bits & 0xf, expectedResult, `result ${a},${b},${cin},${op}`);
    assert.equal(bit(simulator.snapshot, "output-carry"), expectedCarry, `carry ${a},${b},${cin},${op}`);
    assert.equal(bit(simulator.snapshot, "output-zero"), Number(expectedResult === 0), `zero ${a},${b},${cin},${op}`);
    assert.equal(bit(simulator.snapshot, "output-overflow"), expectedOverflow, `overflow ${a},${b},${cin},${op}`);
  }
});
