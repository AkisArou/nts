/*---
description: Control for writes-number-compound-outside; direct reads keep the same input values, operations and observations.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-numbers]
---*/
// Control: Every captured read becomes a direct read at the same point.
const rows: { seed: number; amount: number; expected: number }[] = [
  { seed: 1, amount: 0, expected: 1 }, { seed: 1, amount: 0.5, expected: 1.5 },
  { seed: -0, amount: -0, expected: -0 }, { seed: 1, amount: NaN, expected: NaN },
  { seed: 2147483647, amount: 1, expected: 2147483648 },
  { seed: 4294967295, amount: 1, expected: 4294967296 },
  { seed: 1, amount: Infinity, expected: Infinity }, { seed: 1, amount: -Infinity, expected: -Infinity }
];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const row of rows) {
  const log: string[] = ["initial"]; let value: number = row.seed;

  log.push("read"); const before = value; checkCapture(before, row.seed);
  log.push("compound-read"); value += row.amount; log.push("compound-write");
  log.push("read"); const after = value; checkCapture(after, row.expected);
  value = row.seed; log.push("restore");
  log.push("read"); const restored = value; checkCapture(restored, row.seed);
  log.push("state"); checkCapture(value, row.seed);
  assert.compareArray(log, ["initial", "read", "compound-read", "compound-write", "read", "restore", "read", "state"]);
}
