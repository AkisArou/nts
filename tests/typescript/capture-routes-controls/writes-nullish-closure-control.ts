/*---
description: Control for writes-nullish-closure; direct reads keep the same input values, operations and observations.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-numbers, ts-unions]
---*/
// Control: Every captured read becomes a direct read at the same point.
const rows: { seed: number | undefined; replacement: number | undefined; expected: number | undefined; writes: boolean }[] = [
  { seed: undefined, replacement: -0, expected: -0, writes: true },
  { seed: undefined, replacement: NaN, expected: NaN, writes: true },
  { seed: undefined, replacement: 1.5, expected: 1.5, writes: true },
  { seed: undefined, replacement: 2147483648, expected: 2147483648, writes: true },
  { seed: undefined, replacement: undefined, expected: undefined, writes: true },
  { seed: 0, replacement: 7, expected: 0, writes: false },
  { seed: -0, replacement: 7, expected: -0, writes: false },
  { seed: NaN, replacement: 7, expected: NaN, writes: false }
];
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const row of rows) {
  const log: string[] = ["initial"]; let value: number | undefined = row.seed;
  log.push("read"); const before = value; checkCapture(before, row.seed);
  log.push("nullish-read"); value ??= (log.push("nullish-write"), row.replacement);
  log.push("read"); const after = value; checkCapture(after, row.expected);
  log.push("state"); checkCapture(value, row.expected);
  const expected = row.writes ? ["initial", "read", "nullish-read", "nullish-write", "read", "state"] : ["initial", "read", "nullish-read", "read", "state"];
  assert.compareArray(log, expected);
}
