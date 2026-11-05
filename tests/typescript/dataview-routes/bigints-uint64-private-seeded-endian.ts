/*---
description: "BigUint64 interprets asymmetric raw bytes under both byte orders without losing the high bits or changing storage."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly, ts-tuples, ts-destructuring]
---*/

// BigUint64 interprets asymmetric raw bytes under both byte orders without losing the high bits or changing storage. Route: a private View populated from a constructor parameter. Node prints bigints-uint64-private-seeded-endian:ok.
type View = DataView;
class WideSlot {
  #view: View = new DataView(new ArrayBuffer(8));
  constructor(seed: readonly number[]) { for (let i = 0; i < 8; i++) this.#view.setUint8(i, seed[i]); }
  read(little: boolean): bigint { return this.#view.getBigUint64(0, little); }
  bytes(): number[] { const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = this.#view.getUint8(i); return bytes; }
}
const rows: readonly [readonly number[], readonly bigint[]][] = [
  [[1, 35, 69, 103, 137, 171, 205, 239], [0x123456789abcdefn, 0xefcdab8967452301n]],
  [[137, 171, 205, 239, 1, 35, 69, 103], [0x89abcdef01234567n, 0x67452301efcdab89n]],
  [[128, 0, 0, 0, 0, 0, 0, 1], [0x8000000000000001n, 0x100000000000080n]],
  [[255, 255, 255, 255, 255, 255, 255, 254], [0xfffffffffffffffen, 0xfeffffffffffffffn]]
];
for (const [seed, expected] of rows) {
  const slot = new WideSlot(seed), actual: bigint[] = [slot.read(false), slot.read(true)];
  assert.compareArray(actual, expected); assert.compareArray(slot.bytes(), seed);
}
console.log("bigints-uint64-private-seeded-endian:ok");
