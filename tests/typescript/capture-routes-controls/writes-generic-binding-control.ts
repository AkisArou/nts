/*---
description: Control for writes-generic-binding; direct reads keep the same input values, operations and observations.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-generics, ts-unions, ts-numbers, ts-bigint, ts-strings, ts-objects, ts-arrays]
---*/
// Control: Every captured read becomes a direct read at the same point.
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
function inspectGenericCapture<T>(initial: T, next: T): void {
  const log: string[] = ["initial"]; let value: T = initial;
  log.push("read"); const before = value; checkCapture(before, initial);
  value = next; log.push("write");
  log.push("read"); const after = value; checkCapture(after, next);
  value = initial; log.push("restore");
  log.push("read"); const restored = value; checkCapture(restored, initial);
  log.push("state"); checkCapture(value, initial);
  assert.compareArray(log, ["initial", "read", "write", "read", "restore", "read", "state"]);
}
for (const next of [-0, NaN, 1.5, 2147483648]) inspectGenericCapture<number>(1, next);
for (const next of ["", "ascii", "\u00e9\u4e2d"]) inspectGenericCapture<string>("a", next);
for (const next of [false, true]) inspectGenericCapture<boolean>(false, next);
for (const next of [0n, 9007199254740993n]) inspectGenericCapture<bigint>(1n, next);
for (const next of [undefined, 7]) inspectGenericCapture<number | undefined>(undefined, next);
for (const next of [{ mark: 1 }, { mark: 2 }]) inspectGenericCapture<{ mark: number }>({ mark: 0 }, next);
for (const next of [[1], [-0, NaN]]) inspectGenericCapture<number[]>([], next);
