/*---
description: A captured number binding preserves assignments and restoration across representation changes.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-numbers]
---*/
// Route: number binding captured before assignment and restoration; node reads the current binding at every stage.
const inputs: number[] = [0, -0, NaN, 0.5, -1.5, 2147483648, 4294967296, Infinity, -Infinity];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) {
  const log: string[] = ["initial"]; let value: number = 1;
  const read: () => number = () => { log.push("read"); return value; };
  const before = read(); checkCapture(before, 1);
  value = input; log.push("write");
  const after = read(); checkCapture(after, input);
  value = 1; log.push("restore");
  const restored = read(); checkCapture(restored, 1);
  log.push("state"); checkCapture(value, 1);
  assert.compareArray(log, ["initial", "read", "write", "read", "restore", "read", "state"]);
}
