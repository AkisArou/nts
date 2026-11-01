/*---
description: Control for suspension-await-number-stages; the same stages read the binding directly.
features: [ts-capture-route-suspension, ts-closures, ts-function-types, ts-functions, ts-async, ts-numbers, ts-arrays]
flags: [async]
---*/
// Control: remove the reader closure; direct reads use the same live binding and occur at the same points.
const samples: { before: number; after: number }[] = [
  { before: 1, after: 0.5 }, { before: -0, after: NaN },
  { before: NaN, after: 2147483648 }, { before: 2147483649, after: -0 },
  { before: -0.5, after: 0 }, { before: Infinity, after: -Infinity },
  { before: 0, after: 4294967296 }, { before: 2, after: -0.25 }
];
function captureCheck(actual: unknown, expected: unknown, kind: string): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, kind);
}
async function main(): Promise<void> {
  for (const row of samples) {
    let value: number = 1; const log: string[] = ["write:initial"];
    log.push("read"); captureCheck(value, 1, "number");
    value = row.before; log.push("write:before"); log.push("read"); captureCheck(value, row.before, "number");
    log.push("await:first"); await Promise.resolve(); log.push("resume:first");
    value = row.after; log.push("write:after"); log.push("read"); captureCheck(value, row.after, "number");
    log.push("await:second"); await Promise.resolve(); log.push("resume:second");
    log.push("read"); captureCheck(value, row.after, "number"); captureCheck(value, row.after, "number");
    assert.compareArray(log, ["write:initial", "read", "write:before", "read", "await:first", "resume:first", "write:after", "read", "await:second", "resume:second", "read"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
