/*---
description: Ragged buffers reject omitted Int32 lengths but accept an explicit empty window.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-map-set, ts-readonly, ts-errors]
---*/
type LocalView = { buffer: number[]; byteOffset: number; length: number; byteLength: number; elementWidth: number };
function localArrayBuffer(size: number): number[] { const values: number[] = []; for (let i = 0; i < size; i++) values[i] = 0; return values; }
function localWindow(buffer: number[], offset: number, size: number | undefined, width: number): LocalView {
  const start = Number.isNaN(offset) ? 0 : Math.trunc(offset), length = size === undefined ? (buffer.length - start) / width : Number.isNaN(size) ? 0 : Math.trunc(size);
  if (!Number.isFinite(start) || start < 0 || start % width !== 0 || !Number.isInteger(length) || length < 0 || start + length * width > buffer.length) throw new RangeError();
  return { buffer, byteOffset: start, length, byteLength: length * width, elementWidth: width };
}
function localGet(view: LocalView, index: number): number { return view.buffer[view.byteOffset + index * view.elementWidth]; }
function localInt32Array(buffer: number[], offset = 0, size?: number): LocalView { return localWindow(buffer, offset, size, 4); }
// Ragged buffers reject omitted Int32 lengths but accept an explicit empty window. Route: guarded buffer Map get.
// Node prints construction-layout-window-ragged-map:ok after exact observations.
type BufferStorage = number[];
const buffers = new Map<string, BufferStorage>([["one", localArrayBuffer(1)], ["two", localArrayBuffer(2)], ["six", localArrayBuffer(6)], ["ten", localArrayBuffer(10)]]);
const names: readonly string[] = ["one", "two", "six", "ten"];
for (const name of names) {
  const buffer = buffers.get(name);
  if (buffer === undefined) throw new Error("missing buffer");
  assert.throws(RangeError, () => localInt32Array(buffer));
  const data = localInt32Array(buffer, 0, 0), observed: number[] = [];
  assert.sameValue(data.buffer, buffer);
  assert.sameValue(data.byteOffset, 0);
  assert.sameValue(data.length, 0);
  assert.sameValue(data.byteLength, 0);
  for (let i = 0; i < data.length; i++) observed[i] = localGet(data, i);
  assert.compareArray(observed, []);
}
console.log("construction-layout-window-ragged-map:ok");
