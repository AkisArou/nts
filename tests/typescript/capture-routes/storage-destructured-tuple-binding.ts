/*---
description: A captured typed tuple binding keeps fractional, wide and signed-zero assignments.
features: [ts-capture-route-storage, ts-closures, ts-functions, ts-function-types, ts-destructuring, ts-tuples, ts-numbers]
---*/
// Route: tuple-destructured number binding captured before subsequent tuple assignments; node retains every numeric value.
const inputs: number[] = [0, -0, NaN, 0.5, -1.5, 2147483648, 4294967296, Infinity, -Infinity];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) {
  const log: string[] = ["initial"]; let [value]: [number] = [1];
  const read: () => number = () => { log.push("read"); return value; };
  const before = read(); checkCapture(before, 1);
  [value] = [input]; log.push("destructure");
  const after = read(); checkCapture(after, input);
  [value] = [-0]; log.push("restore");
  const restored = read(); checkCapture(restored, -0);
  log.push("state"); checkCapture(value, -0);
  assert.compareArray(log, ["initial", "read", "destructure", "read", "restore", "read", "state"]);
}
