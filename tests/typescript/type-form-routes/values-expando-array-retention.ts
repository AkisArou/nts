/*---
description: "A typed callable array retains shared expando identity and independent per-function property state."
features: [ts-type-form-routes, ts-type-form-route-values, ts-expando, ts-call-signatures, ts-interfaces, ts-objects, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// Factory-created function expandos cross Reader[] elements and a duplicate slot; node preserves the shared first value and the independent second object.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
interface Reader { (): unknown; value: unknown; }
function make(label: string, initial: unknown): Reader {
  function read(): unknown { log.push(label, read.value); return read.value; }
  read.value = initial; return read;
}
const other = { id: 11 }, first = make("first", undefined), second = make("second", other);
const readers: Reader[] = [first, second, first];
const values: unknown[] = [undefined, false, -0, NaN, "", 0n, { id: 7 }];
for (const value of values) {
  readers[0].value = value; log.length = 0;
  same(readers[2](), value); same(readers[1](), other); same(first.value, value); same(second.value, other);
  same(readers[0], readers[2]); same(readers[0] === readers[1], false); same(typeof readers[0], "function");
  exact(log, ["first", value, "second", other]);
}
