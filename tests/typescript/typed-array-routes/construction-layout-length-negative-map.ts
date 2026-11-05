/*---
description: Negative and infinite Uint32 lengths throw before a valid zero allocation.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-map-set, ts-readonly, ts-errors]
---*/
// Negative and infinite Uint32 lengths throw before a valid zero allocation. Route: guarded numeric Map get.
// Node prints construction-layout-length-negative-map:ok after exact observations.
type Samples = Uint32Array;
const sizes = new Map<string, number>([["negative", -1], ["fraction", -1.9], ["negative infinity", -Infinity], ["infinity", Infinity]]);
const names: readonly string[] = ["negative", "fraction", "negative infinity", "infinity"];
for (const name of names) {
  const size = sizes.get(name);
  if (size === undefined) throw new Error("missing size");
  assert.throws(RangeError, () => new Uint32Array(size));
}
const data: Samples = new Uint32Array(2), observed: number[] = [];
for (let i = 0; i < data.length; i++) observed[i] = data[i];
assert.compareArray(observed, [0, 0]);
console.log("construction-layout-length-negative-map:ok");
