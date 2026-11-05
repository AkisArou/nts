/*---
description: Eight-byte Float64 windows preserve aligned offsets and an empty end window.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples]
---*/
type LocalView = { buffer: number[]; byteOffset: number; length: number; byteLength: number; elementWidth: number };
function localArrayBuffer(size: number): number[] { const values: number[] = []; for (let i = 0; i < size; i++) values[i] = 0; return values; }
function localWindow(buffer: number[], offset: number, size: number | undefined, width: number): LocalView {
  const start = Number.isNaN(offset) ? 0 : Math.trunc(offset), length = size === undefined ? (buffer.length - start) / width : Number.isNaN(size) ? 0 : Math.trunc(size);
  if (!Number.isFinite(start) || start < 0 || start % width !== 0 || !Number.isInteger(length) || length < 0 || start + length * width > buffer.length) throw new RangeError();
  return { buffer, byteOffset: start, length, byteLength: length * width, elementWidth: width };
}
function localGet(view: LocalView, index: number): number { return view.buffer[view.byteOffset + index * view.elementWidth]; }
function localFloat64Array(buffer: number[], offset = 0, size?: number): LocalView { return localWindow(buffer, offset, size, 8); }
// Eight-byte Float64 windows preserve aligned offsets and an empty end window. Route: private window field.
// Node prints construction-layout-window-private-float64:ok after exact observations.
type BufferStorage = number[];
type Samples = LocalView;
class WindowStore {
  #data: Samples;
  constructor(buffer: BufferStorage, offset: number, size: number) { this.#data = localFloat64Array(buffer, offset, size); }
  read(): Samples { return this.#data; }
}
const rows: readonly [number, number, readonly number[]][] = [[0, 2, [0, 0]], [8, 1, [0]], [16, 0, []]];
for (const [offset, size, expected] of rows) {
  const buffer: BufferStorage = localArrayBuffer(16), data = new WindowStore(buffer, offset, size).read();
  const observed: number[] = [];
  assert.sameValue(data.buffer, buffer);
  assert.sameValue(data.byteOffset, offset);
  assert.sameValue(data.length, size);
  assert.sameValue(data.byteLength, size * 8);
  for (let i = 0; i < data.length; i++) observed[i] = localGet(data, i);
  assert.compareArray(observed, expected);
}
console.log("construction-layout-window-private-float64:ok");
