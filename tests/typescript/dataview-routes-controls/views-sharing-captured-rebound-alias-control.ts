/*---
description: "Captured view and byte-array bindings follow a replacement buffer while retained old aliases still share their original bytes through reassigned buffer view and byte-array let bindings captured by closures."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-closures, ts-arrow-functions]
---*/

type LocalView = { buffer: number[]; byteOffset: number; byteLength: number };
function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], byteOffset = 0, byteLength = buffer.length - byteOffset): LocalView { return { buffer, byteOffset, byteLength }; }
function localGetUint8(view: LocalView, offset: number): number { return view.buffer[view.byteOffset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { view.buffer[view.byteOffset + offset] = value; }
function localUint8Array(buffer: number[]): number[] { return buffer; }

// Captured view and byte-array bindings follow a replacement buffer while retained old aliases still share their original bytes; route: reassigned buffer view and byte-array let bindings captured by closures.
// Node prints views-sharing-captured-rebound-alias:ok.
type BufferStorage = number[];
type View = LocalView;
type Bytes = number[];
let buffer: BufferStorage = localArrayBuffer(6);
let currentView: View = localDataView(buffer, 1, 3), bytes: Bytes = localUint8Array(buffer);
const write = (value: number): void => localSetUint8(currentView, 1, value);
const read = (): number => bytes[currentView.byteOffset + 1];
write(17); assert.sameValue(read(), 17);
const oldBuffer = buffer, oldView = currentView, oldBytes = bytes;
buffer = localArrayBuffer(8); currentView = localDataView(buffer, 3, 3); bytes = localUint8Array(buffer);
bytes[4] = 128; assert.sameValue(localGetUint8(currentView, 1), 128);
write(255); assert.sameValue(read(), 255); assert.sameValue(localGetUint8(oldView, 1), 17);
oldBytes[2] = 31; assert.sameValue(localGetUint8(oldView, 1), 31); assert.sameValue(localGetUint8(currentView, 1), 255);
assert.sameValue(oldView.buffer === oldBuffer, true); assert.sameValue(currentView.buffer === buffer, true); assert.sameValue(buffer === oldBuffer, false);
const previousWhole: View = localDataView(oldBuffer), currentWhole: View = localDataView(buffer);
const previous: number[] = []; for (let i = 0; i < 6; i++) previous[i] = localGetUint8(previousWhole, i);
const observed: number[] = []; for (let i = 0; i < 8; i++) observed[i] = localGetUint8(currentWhole, i);
assert.compareArray(previous, [0, 0, 31, 0, 0, 0]); assert.compareArray(observed, [0, 0, 0, 0, 255, 0, 0, 0]);
console.log("views-sharing-captured-rebound-alias:ok");
