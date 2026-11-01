/*---
description: Control for loops-for-update-created-reader; direct reads retain the same inputs, writes and observations.
features: [ts-capture-route-loops, ts-closures, ts-function-types, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Control: remove readers; directly read live bindings and retained iteration slots at the same points.
const inputs: number[] = [0, -0, NaN, 0.5, -1.25, 2147483648, 4294967296, Infinity];
function checkLoop(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
for (const input of inputs) {
  const log: string[] = []; const bodySlots: number[] = []; const updateSlots: number[] = [];
  let turn = 0; let lastUpdate: number = 0;
  for (let value: number = 0; turn < 2; lastUpdate = value = input, log.push("write:update:" + turn), updateSlots.push(value), log.push("retain:update:" + turn), turn++) {
    const before = (log.push("read:before:" + turn), value); checkLoop(before, turn === 0 ? 0 : input);
    value = turn + 1; log.push("write:body:" + turn); if (turn > 0) updateSlots[turn - 1] = value;
    const after = (log.push("read:after:" + turn), value); checkLoop(after, turn + 1);
    bodySlots.push(value); log.push("retain:body:" + turn);
  }
  const expectedBodies: number[] = [1, 2]; const expectedUpdates: number[] = [2, input];
  for (let at = 0; at < 2; at++) {
    const body = (log.push("read:body:" + at), bodySlots[at]); checkLoop(body, expectedBodies[at]);
    const update = (log.push("read:update:" + at), updateSlots[at]); checkLoop(update, expectedUpdates[at]);
    checkLoop(bodySlots[at], expectedBodies[at]); checkLoop(updateSlots[at], expectedUpdates[at]);
  }
  checkLoop(lastUpdate, input); assert.sameValue(turn, 2); assert.sameValue(bodySlots.length, 2); assert.sameValue(updateSlots.length, 2);
  assert.compareArray(log, ["read:before:0", "write:body:0", "read:after:0", "retain:body:0", "write:update:0", "retain:update:0", "read:before:1", "write:body:1", "read:after:1", "retain:body:1", "write:update:1", "retain:update:1", "read:body:0", "read:update:0", "read:body:1", "read:update:1"]);
}
