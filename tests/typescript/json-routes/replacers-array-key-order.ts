/*---
description: An interface-held replacer array selects and orders keys, converts numeric entries to keys and ignores duplicate selections.
features: [ts-json-routes, ts-json-replacers, ts-interfaces, ts-objects, ts-arrays, ts-unions, ts-iteration, ts-numbers, ts-strings]
---*/
// Stringify an interface-held value with its typed key list; node follows the first b, 2, a selections rather than source key order.
interface JsonSelection {
  value: { a: number; b: number; 2: string; omitted: boolean }; keys: (string | number)[];
}
for (const n of [-2, 0, 3]) {
  const options: JsonSelection = { value: { a: n, b: n + 1, 2: "two", omitted: true }, keys: ["b", 2, "a", "b", 2] };
  assert.sameValue(JSON.stringify(options.value, options.keys), '{"b":' + (n + 1) + ',"2":"two","a":' + n + '}');
  assert.compareArray(Object.keys(options.value), ["2", "a", "b", "omitted"]);
  assert.compareArray(options.keys, ["b", 2, "a", "b", 2]);
}
