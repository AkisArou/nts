/*---
description: Numeric compound assignment outside the reader preserves the shared capture.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-numbers]
---*/
// Route: number binding read before and after += outside; node keeps fractions, wide integers, NaN and the zero sign.
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
  const read: () => number = () => { log.push("read"); return value; };

  const before = read(); checkCapture(before, row.seed);
  log.push("compound-read"); value += row.amount; log.push("compound-write");
  const after = read(); checkCapture(after, row.expected);
  value = row.seed; log.push("restore");
  const restored = read(); checkCapture(restored, row.seed);
  log.push("state"); checkCapture(value, row.seed);
  assert.compareArray(log, ["initial", "read", "compound-read", "compound-write", "read", "restore", "read", "state"]);
}
