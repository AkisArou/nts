/*---
description: Explicit metadata record control for Computed method names retain exact property text through a typed function return.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-interfaces]
---*/
// Explicit records: A Numeric return carries methods named by empty, numeric and Unicode computed keys; node keeps exact text and the first-default arity.
interface Metadata { label: string; arity: number; }
function make(key: string, form: number): Metadata { return { label: key, arity: form === 0 ? 0 : 1 }; }
function observe(target: Metadata): [string, number] { return [target.label, target.arity]; }
const keys: string[] = ["", "7", "run task", "__proto__", "\u00e9\u4e2d"];
const forms: [number, number][] = [[0, 0], [1, 1], [2, 1]];
for (const key of keys) for (const [form, arity] of forms) {
  const actual = observe(make(key, form));
  assert.sameValue(actual[0], key); assert.sameValue(actual[1], arity);
  assert.compareArray(actual, [key, arity]);
}
