/*---
description: Sibling bigint closures preserve compound writes beyond the safe-integer boundary.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-bigint]
---*/
// Route: bigint binding shared by reader and compound writer, then restored outside; node keeps the bigint value and type.
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
  const read: () => bigint = () => { log.push("read"); return value; };
  const add: (amount: bigint) => void = amount => { log.push("compound-read"); value += amount; log.push("compound-write"); };
  const before = read(); checkCapture(before, 1n);
  add(row.amount); const after = read(); checkCapture(after, row.expected);
  value = 1n; log.push("restore"); const restored = read(); checkCapture(restored, 1n);
  log.push("state"); checkCapture(value, 1n);
  assert.compareArray(log, ["initial", "read", "compound-read", "compound-write", "read", "restore", "read", "state"]);
}
