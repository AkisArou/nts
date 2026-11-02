/*---
description: Computed method names retain exact property text through a typed function return.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-function-types, ts-computed-keys, ts-default-parameters]
---*/
// A Numeric return carries methods named by empty, numeric and Unicode computed keys; node keeps exact text and the first-default arity.
type Numeric = (a: number, b: number, c: number) => number;
function make(key: string, form: number): Numeric {
  if (form === 0) return { [key](): number { return 0; } }[key];
  if (form === 1) return { [key](a: number): number { return a; } }[key];
  return { [key](a: number, b = 2, c?: number): number { return a + b + (c ?? 0); } }[key];
}
function observe(target: Numeric): [string, number] { return [target.name, target.length]; }
const keys: string[] = ["", "7", "run task", "__proto__", "\u00e9\u4e2d"];
const forms: [number, number][] = [[0, 0], [1, 1], [2, 1]];
for (const key of keys) for (const [form, arity] of forms) {
  const actual = observe(make(key, form));
  assert.sameValue(actual[0], key); assert.sameValue(actual[1], arity);
  assert.compareArray(actual, [key, arity]);
}
