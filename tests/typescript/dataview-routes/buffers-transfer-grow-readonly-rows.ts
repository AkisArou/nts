/*---
description: "Transfer with a requested length retains the prefix and zero-fills every newly allocated byte through readonly tuples of requested lengths."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-readonly, ts-tuples]
---*/

// Transfer with a requested length retains the prefix and zero-fills every newly allocated byte; route: readonly tuples of requested lengths.
// Node prints buffers-transfer-grow-readonly-rows:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
const rows: readonly [number, readonly number[]][] = [[0, []], [1, [11]], [4, [11, 22, 33, 44]], [8, [11, 22, 33, 44, 0, 0, 0, 0]]];
for (const [length, expected] of rows) {
  const source: BufferStorage = new ArrayBuffer(4), before: View = new DataView(source);
  for (let i = 0; i < 4; i++) before.setUint8(i, 11 * (i + 1));
  const moved = source.transfer(length), view: View = new DataView(moved);
  assert.sameValue(source.detached, true); assert.sameValue(source.byteLength, 0);
  assert.sameValue(moved.byteLength, length); assert.sameValue(moved.maxByteLength, length); assert.sameValue(moved.resizable, false);
  const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expected);
}
console.log("buffers-transfer-grow-readonly-rows:ok");
