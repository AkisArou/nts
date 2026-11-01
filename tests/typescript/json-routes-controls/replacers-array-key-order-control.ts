/*---
description: Control for replacers-array-key-order; use a plain literal at the tested route.
features: [ts-json-routes, ts-json-replacers, ts-interfaces, ts-objects, ts-arrays, ts-unions, ts-iteration, ts-numbers, ts-strings]
---*/
// Remove only the options interface annotation; the plain literal contains the same source value and selection array.
interface JsonSelection {
  value: { a: number; b: number; 2: string; omitted: boolean }; keys: (string | number)[];
}
for (const n of [-2, 0, 3]) {
  const options = { value: { a: n, b: n + 1, 2: "two", omitted: true }, keys: ["b", 2, "a", "b", 2] };
  assert.sameValue(JSON.stringify(options.value, options.keys), '{"b":' + (n + 1) + ',"2":"two","a":' + n + '}');
  assert.compareArray(Object.keys(options.value), ["2", "a", "b", "omitted"]);
  assert.compareArray(options.keys, ["b", 2, "a", "b", 2]);
}
