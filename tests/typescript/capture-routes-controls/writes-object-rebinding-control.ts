/*---
description: Control for writes-object-rebinding; direct reads keep the same input values, operations and observations.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-interfaces, ts-objects, ts-numbers]
---*/
// Control: Every captured read becomes a direct read at the same point.
const inputs: number[] = [0, -0, NaN, 0.5, -1.5, 2147483648, 4294967296, Infinity, -Infinity];
interface CapturedRecord { value: number; }
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) {
  const log: string[] = ["initial"]; const original: CapturedRecord = { value: 1 };
  const replacement: CapturedRecord = { value: 2 }; let value: CapturedRecord = original;
  log.push("read"); const before = value; checkCapture(before, original); checkCapture(before.value, 1);
  value = replacement; log.push("rebind");
  log.push("read"); const rebound = value; checkCapture(rebound, replacement); checkCapture(rebound.value, 2);
  original.value = -1; log.push("old-write"); replacement.value = input; log.push("new-write");
  log.push("read"); const after = value; checkCapture(after, replacement); checkCapture(after.value, input);
  log.push("state"); checkCapture(value, replacement); checkCapture(original.value, -1); checkCapture(replacement.value, input);
  assert.compareArray(log, ["initial", "read", "rebind", "read", "old-write", "new-write", "read", "state"]);
}
