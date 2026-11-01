/*---
description: One generic capture preserves writes and restoration at primitive, union, object and array instantiations.
features: [ts-capture-route-writes, ts-closures, ts-functions, ts-function-types, ts-generics, ts-unions, ts-numbers, ts-bigint, ts-strings, ts-objects, ts-arrays]
---*/
// Route: generic T binding captured before two assignments; node reads the current value at every instantiation.
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
function inspectGenericCapture<T>(initial: T, next: T): void {
  const log: string[] = ["initial"]; let value: T = initial;
  const read: () => T = () => { log.push("read"); return value; };
  const before = read(); checkCapture(before, initial);
  value = next; log.push("write");
  const after = read(); checkCapture(after, next);
  value = initial; log.push("restore");
  const restored = read(); checkCapture(restored, initial);
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
