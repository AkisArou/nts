/*---
description: Control for writes-bigint-compound-shared; direct reads keep the same input values, operations and observations.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-bigint]
---*/
// Control: Every captured read becomes a direct read at the same point.
const rows: { amount: bigint; expected: bigint }[] = [
  { amount: -1n, expected: 0n }, { amount: 0n, expected: 1n }, { amount: 2n, expected: 3n },
  { amount: 9007199254740993n, expected: 9007199254740994n },
  { amount: -9007199254740993n, expected: -9007199254740992n }
];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const row of rows) {
  const log: string[] = ["initial"]; let value: bigint = 1n;
  log.push("read"); const before = value; checkCapture(before, 1n);
  log.push("compound-read"); value += row.amount; log.push("compound-write"); log.push("read"); const after = value; checkCapture(after, row.expected);
  value = 1n; log.push("restore"); log.push("read"); const restored = value; checkCapture(restored, 1n);
  log.push("state"); checkCapture(value, 1n);
  assert.compareArray(log, ["initial", "read", "compound-read", "compound-write", "read", "restore", "read", "state"]);
}
