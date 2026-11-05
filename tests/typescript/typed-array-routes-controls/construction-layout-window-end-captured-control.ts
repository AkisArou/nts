/*---
description: Omitted lengths use the remaining buffer and become empty at its end.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-closures, ts-function-types, ts-arrow-functions, ts-readonly, ts-tuples]
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
// Omitted lengths use the remaining buffer and become empty at its end. Route: captured replaced window binding.
// Node prints construction-layout-window-end-captured:ok after exact observations.
type BufferStorage = number[];
type Samples = LocalView;
const buffer: BufferStorage = localArrayBuffer(8);
let data: Samples = localInt32Array(buffer);
const read: () => Samples = () => data;
const rows: readonly [number, readonly number[]][] = [[0, [0, 0]], [4, [0]], [8, []]];
for (const [offset, expected] of rows) {
  data = localInt32Array(buffer, offset);
  const view = read(), observed: number[] = [];
  assert.sameValue(view, data);
  assert.sameValue(view.buffer, buffer);
  assert.sameValue(view.byteOffset, offset);
  assert.sameValue(view.length, expected.length);
  assert.sameValue(view.byteLength, expected.length * 4);
  for (let i = 0; i < view.length; i++) observed[i] = localGet(view, i);
  assert.compareArray(observed, expected);
}
console.log("construction-layout-window-end-captured:ok");
