/*---
description: Generic optional-element storage distinguishes grown holes from explicit undefined.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-arrays, ts-generics, ts-unions, ts-numbers, ts-strings, ts-objects, ts-tuples]
---*/
// A generic grows an optional-element array; node leaves new holes absent while a later undefined store owns its slot.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type BoundsValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 };
const rows: [BoundsValue, string][] = [[undefined, "null"], [null, "null"], [0, "0"], [-0, "0"], ["", '""'], [NaN, "null"], [false, "false"], [marker, '{"id":7}']];
function grow<T>(value: T): (T | undefined)[] { const xs: (T | undefined)[] = [value]; xs.length = 4; xs[2] = undefined; return xs; }
function read<T>(xs: (T | undefined)[], index: number): T | undefined { return xs[index]; }
for (const [value, json] of rows) {
  const source = grow(value), keys = Object.keys(source);
  same(source.length, 4); assert.compareArray(keys, ["0", "2"]);
  same(JSON.stringify(source), "[" + json + ",null,null,null]");
  for (const index of [0, 1, 2, 3, 4]) {
    same(read(source, index), index === 0 ? value : undefined);
    same(index in source, index === 0 || index === 2); same(Object.hasOwn(source, index), index === 0 || index === 2);
  }
}
