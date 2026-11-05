/*---
description: "Uint8 reads retain each seeded high bit as an unsigned value while Int8 reads give the corresponding signed values."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-class, ts-class-fields, ts-static, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Uint8 reads retain each seeded high bit as an unsigned value while Int8 reads give the corresponding signed values. Route: a static View field reused across different byte populations. Node prints integers-uint8-static-seeded-signedness:ok.
type View = DataView;
class ByteBank { static view: View = new DataView(new ArrayBuffer(4)); }
const rows: readonly [readonly number[], readonly number[]][] = [
  [[0, 1, 128, 255], [0, 1, -128, -1]], [[127, 129, 254, 42], [127, -127, -2, 42]]
];
for (const [seed, signed] of rows) {
  for (let i = 0; i < 4; i++) ByteBank.view.setUint8(i, seed[i]);
  const unsigned: number[] = [], actualSigned: number[] = [];
  for (let i = 0; i < 4; i++) { unsigned[i] = ByteBank.view.getUint8(i); actualSigned[i] = ByteBank.view.getInt8(i); }
  assert.compareArray(unsigned, seed); assert.compareArray(actualSigned, signed);
}
console.log("integers-uint8-static-seeded-signedness:ok");
