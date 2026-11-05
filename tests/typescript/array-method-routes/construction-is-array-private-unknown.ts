/*---
description: "Array.isArray distinguishes arrays from typed arrays, array-likes, strings, nullish values and ordinary objects."
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-objects, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-unknown, ts-readonly, ts-tuples, ts-strings, ts-null-undefined, ts-destructuring]
---*/

// Array.isArray distinguishes arrays from typed arrays, array-likes, strings, nullish values and ordinary objects. Route: a private unknown field. Node prints construction-is-array-private-unknown:ok.
const marker = { id: 7 }, emptyValues: unknown[] = [], values: unknown[] = [marker];
const bytes = new Uint8Array([1]);
class ArrayProbe {
  #value: unknown; constructor(value: unknown) { this.#value = value; }
  read(): boolean { return Array.isArray(this.#value); }
}
const rows: readonly [unknown, boolean][] = [
  [emptyValues, true], [values, true], [bytes, false], [{ 0: marker, length: 1 }, false],
  ["[]", false], [null, false], [undefined, false], [marker, false]
];
for (const [value, expected] of rows) assert.sameValue(new ArrayProbe(value).read(), expected);
console.log("construction-is-array-private-unknown:ok");
