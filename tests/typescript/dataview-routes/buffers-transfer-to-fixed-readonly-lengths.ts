/*---
description: "TransferToFixedLength copies the prefix and can grow beyond the old resizable maximum through readonly tuples of target lengths."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-readonly, ts-tuples]
---*/

// TransferToFixedLength copies the prefix and can grow beyond the old resizable maximum; route: readonly tuples of target lengths.
// Node prints buffers-transfer-to-fixed-readonly-lengths:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
const rows: readonly [number, readonly number[]][] = [[0, []], [2, [1, 2]], [4, [1, 2, 3, 4]], [10, [1, 2, 3, 4, 0, 0, 0, 0, 0, 0]]];
for (const [length, expected] of rows) {
  const source: BufferStorage = new ArrayBuffer(4, { maxByteLength: 6 }), before: View = new DataView(source);
  for (let i = 0; i < 4; i++) before.setUint8(i, i + 1);
  const moved = source.transferToFixedLength(length), view: View = new DataView(moved);
  assert.sameValue(source.detached, true); assert.sameValue(moved.byteLength, length);
  assert.sameValue(moved.resizable, false); assert.sameValue(moved.maxByteLength, length);
  const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expected);
}
console.log("buffers-transfer-to-fixed-readonly-lengths:ok");
