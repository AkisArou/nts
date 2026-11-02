/*---
description: "Explicit conversion control: A constrained generic array parameter is converted once by an untagged template."
features: [ts-template-routes, ts-template-route-substitutions, ts-strings, ts-conversions, ts-arrays, ts-functions, ts-typeof-operator, ts-unknown, ts-type-aliases, ts-unions, ts-numbers, ts-bigint, ts-null-undefined, ts-tuples, ts-readonly, ts-generics, ts-generic-constraints]
---*/
// Typed arrays include nested arrays, empty elements and nullish members; node uses comma-separated array text inside brackets and preserves the original array identity. The control uses ordered String calls and concatenation.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type Scalar = string | number | boolean | bigint | null | undefined;

type Entry = Scalar | Scalar[];
const rows: [Entry[], string][] = [
  [[], "[]"], [[null, undefined, ""], "[,,]"], [[1, [2, 3]], "[1,2,3]"],
  [[false, [null, "a"], -0], "[false,,a,0]"], [[12n, [], undefined], "[12,,]"],
  [[NaN, 1e21, 1e-7], "[NaN,1e+21,1e-7]"], [[["", "\ud83d\ude00"], true], "[,\ud83d\ude00,true]"],
];
const log: unknown[] = [], wanted: unknown[] = [];
function render<T extends readonly Entry[]>(values: T, index: number): string {
  same(values, rows[index][0]); assert.compareArray(values, rows[index][0]);
  const text = "[" + String(values) + "]"; log.push(values, text); return text;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index], values: Entry[] = row[0];
  assert.sameValue(render(values, index), row[1]); same(values, row[0]);
  wanted.push(row[0], row[1]);
}
assert.compareArray(log, wanted);
