/*---
description: "Closures resize and read the current buffer and view after replacement through captured let bindings."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-closures, ts-arrow-functions]
---*/

// Closures resize and read the current buffer and view after replacement; route: captured let bindings.
// Node prints buffers-resize-captured-let-rebound:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
let buffer: BufferStorage = new ArrayBuffer(4, { maxByteLength: 8 });
let view: View = new DataView(buffer);
const resize = (size: number): void => buffer.resize(size), readLength = (): number => view.byteLength;
view.setUint8(0, 7); const firstBuffer = buffer, firstView = view;
resize(6); assert.sameValue(readLength(), 6);
buffer = new ArrayBuffer(2, { maxByteLength: 8 }); view = new DataView(buffer);
view.setUint8(0, 9); view.setUint8(1, 8); resize(4);
assert.sameValue(readLength(), 4); assert.sameValue(view.buffer === buffer, true);
assert.sameValue(firstView.buffer === firstBuffer, true); assert.sameValue(firstView.byteLength, 6);
assert.sameValue(firstView.getUint8(0), 7);
const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = view.getUint8(i);
assert.compareArray(bytes, [9, 8, 0, 0]);
console.log("buffers-resize-captured-let-rebound:ok");
