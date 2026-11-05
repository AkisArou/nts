/*---
description: "Captured view and byte-array bindings follow a replacement buffer while retained old aliases still share their original bytes through reassigned buffer view and byte-array let bindings captured by closures."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-closures, ts-arrow-functions]
---*/

// Captured view and byte-array bindings follow a replacement buffer while retained old aliases still share their original bytes; route: reassigned buffer view and byte-array let bindings captured by closures.
// Node prints views-sharing-captured-rebound-alias:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
type Bytes = Uint8Array<ArrayBuffer>;
let buffer: BufferStorage = new ArrayBuffer(6);
let currentView: View = new DataView(buffer, 1, 3), bytes: Bytes = new Uint8Array(buffer);
const write = (value: number): void => currentView.setUint8(1, value);
const read = (): number => bytes[currentView.byteOffset + 1];
write(17); assert.sameValue(read(), 17);
const oldBuffer = buffer, oldView = currentView, oldBytes = bytes;
buffer = new ArrayBuffer(8); currentView = new DataView(buffer, 3, 3); bytes = new Uint8Array(buffer);
bytes[4] = 128; assert.sameValue(currentView.getUint8(1), 128);
write(255); assert.sameValue(read(), 255); assert.sameValue(oldView.getUint8(1), 17);
oldBytes[2] = 31; assert.sameValue(oldView.getUint8(1), 31); assert.sameValue(currentView.getUint8(1), 255);
assert.sameValue(oldView.buffer === oldBuffer, true); assert.sameValue(currentView.buffer === buffer, true); assert.sameValue(buffer === oldBuffer, false);
const previousWhole: View = new DataView(oldBuffer), currentWhole: View = new DataView(buffer);
const previous: number[] = []; for (let i = 0; i < 6; i++) previous[i] = previousWhole.getUint8(i);
const observed: number[] = []; for (let i = 0; i < 8; i++) observed[i] = currentWhole.getUint8(i);
assert.compareArray(previous, [0, 0, 31, 0, 0, 0]); assert.compareArray(observed, [0, 0, 0, 0, 255, 0, 0, 0]);
console.log("views-sharing-captured-rebound-alias:ok");
