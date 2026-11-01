/*---
description: A captured array binding observes element mutation, reassignment and later writes to both arrays.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-arrays, ts-numbers]
---*/
// Route: array binding captured before push and reassignment; node retains each array identity and reads the latest binding.
const inputs: number[] = [0, -0, NaN, 0.5, -1.5, 2147483648, 4294967296, Infinity, -Infinity];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) {
  const log: string[] = ["initial"]; const original: number[] = [1]; let value: number[] = original;
  const read: () => number[] = () => { log.push("read"); return value; };
  const before = read(); checkCapture(before, original); assert.compareArray(before, [1]);
  original.push(input); log.push("push");
  const grown = read(); checkCapture(grown, original); assert.compareArray(grown, [1, input]); checkCapture(grown[1], input);
  const replacement: number[] = [2]; value = replacement; log.push("rebind");
  replacement[0] = input; log.push("replace-element"); original[0] = -1; log.push("old-element");
  const after = read(); checkCapture(after, replacement); assert.compareArray(after, [input]); checkCapture(after[0], input);
  log.push("state"); checkCapture(value, replacement); assert.compareArray(original, [-1, input]); assert.compareArray(replacement, [input]);
  assert.compareArray(log, ["initial", "read", "push", "read", "rebind", "replace-element", "old-element", "read", "state"]);
}
