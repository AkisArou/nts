/*---
description: "Successive transfers detach each previous generation and zero-fill bytes discarded before regrowth through captured buffer and view bindings."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-closures, ts-arrow-functions, ts-readonly, ts-tuples, ts-errors]
---*/

// Successive transfers detach each previous generation and zero-fill bytes discarded before regrowth; route: captured buffer and view bindings.
// Node prints buffers-transfer-captured-let-generations:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
let buffer: BufferStorage = new ArrayBuffer(4, { maxByteLength: 8 });
let view: View = new DataView(buffer);
for (let i = 0; i < 4; i++) view.setUint8(i, 10 * (i + 1));
const move = (size: number): void => { buffer = buffer.transfer(size); view = new DataView(buffer); };
const rows: readonly [number, readonly number[]][] = [[6, [10, 20, 30, 40, 0, 0]], [2, [10, 20]], [5, [10, 20, 0, 0, 0]]];
for (const [size, expected] of rows) {
  const previous = buffer, oldView = view; move(size);
  assert.sameValue(previous.detached, true); assert.sameValue(oldView.buffer === previous, true);
  assert.throws(TypeError, () => oldView.byteLength);
  assert.sameValue(view.buffer === buffer, true); assert.sameValue(view.byteLength, size);
  const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expected);
}
console.log("buffers-transfer-captured-let-generations:ok");
