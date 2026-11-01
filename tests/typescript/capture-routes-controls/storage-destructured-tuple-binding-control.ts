/*---
description: Control for storage-destructured-tuple-binding; direct reads keep the same input values, operations and observations.
features: [ts-capture-route-storage, ts-closures, ts-functions, ts-function-types, ts-destructuring, ts-tuples, ts-numbers]
---*/
// Control: Every captured read becomes a direct read at the same point.
const inputs: number[] = [0, -0, NaN, 0.5, -1.5, 2147483648, 4294967296, Infinity, -Infinity];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) {
  const log: string[] = ["initial"]; let [value]: [number] = [1];
  log.push("read"); const before = value; checkCapture(before, 1);
  [value] = [input]; log.push("destructure");
  log.push("read"); const after = value; checkCapture(after, input);
  [value] = [-0]; log.push("restore");
  log.push("read"); const restored = value; checkCapture(restored, -0);
  log.push("state"); checkCapture(value, -0);
  assert.compareArray(log, ["initial", "read", "destructure", "read", "restore", "read", "state"]);
}
