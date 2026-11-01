/*---
description: Control for replacers-array-nested-selection; use a plain literal at the tested route.
features: [ts-json-routes, ts-json-replacers, ts-interfaces, ts-objects, ts-arrays, ts-unions, ts-iteration, ts-numbers, ts-strings]
---*/
// Remove only the options interface annotation; the plain literal retains the same nested value and key list.
interface JsonSelection {
  value: { b: number; nested: { b: number; a: number; skip: boolean }; a: number; list: ({ b: number; a: number; skip: boolean } | number)[] };
  keys: (string | number)[];
}
for (const n of [-2, 0, 3]) {
  const options = { value: { b: 2, nested: { b: n, a: -0, skip: true }, a: n,
    list: [{ b: n, a: 3, skip: false }, n] }, keys: ["nested", "a", "b", "list", "a"] };
  const expected = '{"nested":{"a":0,"b":' + n + '},"a":' + n + ',"b":2,"list":[{"a":3,"b":' + n + '},' + n + ']}';
  assert.sameValue(JSON.stringify(options.value, options.keys), expected);
  assert.sameValue(Object.is(options.value.nested.a, -0), true); assert.sameValue(options.value.list.length, 2);
  assert.compareArray(Object.keys(options.value.nested), ["b", "a", "skip"]);
}
