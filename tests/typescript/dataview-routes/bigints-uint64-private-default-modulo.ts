/*---
description: "BigUint64 uses big endian by default, preserves the top bit and reduces negative or oversized values modulo two to the sixty-fourth."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly, ts-tuples, ts-destructuring]
---*/

// BigUint64 uses big endian by default, preserves the top bit and reduces negative or oversized values modulo two to the sixty-fourth. Route: a private View field. Node prints bigints-uint64-private-default-modulo:ok.
type View = DataView;
class WideSlot {
  #view: View = new DataView(new ArrayBuffer(8));
  constructor() { for (let i = 0; i < 8; i++) this.#view.setUint8(i, 165); }
  write(value: bigint): void { this.#view.setBigUint64(0, value); }
  read(): bigint { return this.#view.getBigUint64(0); }
  bytes(): number[] { const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = this.#view.getUint8(i); return bytes; }
}
const rows: readonly [bigint, bigint, readonly number[]][] = [
  [-0x10000000000000001n, 0xffffffffffffffffn, [255, 255, 255, 255, 255, 255, 255, 255]],
  [-0x8000000000000001n, 0x7fffffffffffffffn, [127, 255, 255, 255, 255, 255, 255, 255]],
  [-0x1n, 0xffffffffffffffffn, [255, 255, 255, 255, 255, 255, 255, 255]],
  [0x0n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [0x7fffffffffffffffn, 0x7fffffffffffffffn, [127, 255, 255, 255, 255, 255, 255, 255]],
  [0x8000000000000000n, 0x8000000000000000n, [128, 0, 0, 0, 0, 0, 0, 0]],
  [0x8000000000000001n, 0x8000000000000001n, [128, 0, 0, 0, 0, 0, 0, 1]],
  [0xffffffffffffffffn, 0xffffffffffffffffn, [255, 255, 255, 255, 255, 255, 255, 255]],
  [0x10000000000000000n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [0x10000000000000001n, 0x1n, [0, 0, 0, 0, 0, 0, 0, 1]]
];
for (const [value, expected, expectedBytes] of rows) {
  const slot = new WideSlot(); slot.write(value); assert.sameValue(slot.read(), expected); assert.compareArray(slot.bytes(), expectedBytes);
}
console.log("bigints-uint64-private-default-modulo:ok");
