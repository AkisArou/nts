/*---
description: A captured object binding follows reassignment while preserving old and new object identities.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-interfaces, ts-objects, ts-numbers]
---*/
// Route: object binding captured before replacement and later writes to both objects; node reads the replacement identity and its live field.
const inputs: number[] = [0, -0, NaN, 0.5, -1.5, 2147483648, 4294967296, Infinity, -Infinity];
interface CapturedRecord { value: number; }
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) {
  const log: string[] = ["initial"]; const original: CapturedRecord = { value: 1 };
  const replacement: CapturedRecord = { value: 2 }; let value: CapturedRecord = original;
  const read: () => CapturedRecord = () => { log.push("read"); return value; };
  const before = read(); checkCapture(before, original); checkCapture(before.value, 1);
  value = replacement; log.push("rebind");
  const rebound = read(); checkCapture(rebound, replacement); checkCapture(rebound.value, 2);
  original.value = -1; log.push("old-write"); replacement.value = input; log.push("new-write");
  const after = read(); checkCapture(after, replacement); checkCapture(after.value, input);
  log.push("state"); checkCapture(value, replacement); checkCapture(original.value, -1); checkCapture(replacement.value, input);
  assert.compareArray(log, ["initial", "read", "rebind", "read", "old-write", "new-write", "read", "state"]);
}
