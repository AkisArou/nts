/*---
description: An interface-held replacer array applies its property order at every object depth while preserving all array positions.
features: [ts-json-routes, ts-json-replacers, ts-interfaces, ts-objects, ts-arrays, ts-unions, ts-iteration, ts-numbers, ts-strings]
---*/
// Reuse a typed key list inside nested objects and an array; node omits unselected object keys without filtering array indices.
interface JsonSelection {
  value: { b: number; nested: { b: number; a: number; skip: boolean }; a: number; list: ({ b: number; a: number; skip: boolean } | number)[] };
  keys: (string | number)[];
}
for (const n of [-2, 0, 3]) {
  const options: JsonSelection = { value: { b: 2, nested: { b: n, a: -0, skip: true }, a: n,
    list: [{ b: n, a: 3, skip: false }, n] }, keys: ["nested", "a", "b", "list", "a"] };
  const expected = '{"nested":{"a":0,"b":' + n + '},"a":' + n + ',"b":2,"list":[{"a":3,"b":' + n + '},' + n + ']}';
  assert.sameValue(JSON.stringify(options.value, options.keys), expected);
  assert.sameValue(Object.is(options.value.nested.a, -0), true); assert.sameValue(options.value.list.length, 2);
  assert.compareArray(Object.keys(options.value.nested), ["b", "a", "skip"]);
}
