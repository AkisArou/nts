/*---
description: "Uint8 fractional offsets select the truncated first, middle and last byte and preserve every neighbor."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-map-set, ts-strings, ts-narrowing, ts-errors, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Uint8 fractional offsets select the truncated first, middle and last byte and preserve every neighbor. Route: numeric offsets read through guarded Map.get. Node prints integers-uint8-map-fractional-offsets:ok.
type View = DataView;
const offsets: Map<string, number> = new Map([["first", -0.9], ["middle", 1.9], ["last", 3.9]]);
const rows: readonly [string, number, readonly number[]][] = [
  ["first", 255, [255, 0, 0, 0]], ["middle", 128, [0, 128, 0, 0]], ["last", 17, [0, 0, 0, 17]]
];
for (const [key, value, expectedBytes] of rows) {
  const offset = offsets.get(key); if (offset === undefined) throw new Error("missing offset");
  const view: View = new DataView(new ArrayBuffer(4)); view.setUint8(offset, value);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(view.getUint8(offset), value);
}
console.log("integers-uint8-map-fractional-offsets:ok");
