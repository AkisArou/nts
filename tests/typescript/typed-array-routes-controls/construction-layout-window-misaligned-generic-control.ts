/*---
description: Misaligned Int32 offsets throw while an aligned neighbor succeeds.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-generics, ts-errors]
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
// Misaligned Int32 offsets throw while an aligned neighbor succeeds. Route: constrained helper at two type arguments.
// Node prints construction-layout-window-misaligned-generic:ok after exact observations.
type BufferStorage = number[];
type WindowInput = { offset: number; size: number };
type NamedWindowInput = { offset: number; size: number; label: string };
function checkWindow<T extends WindowInput>(input: T): void {
  const buffer: BufferStorage = localArrayBuffer(8);
  assert.throws(RangeError, () => localInt32Array(buffer, input.offset, input.size));
  const data = localInt32Array(buffer, 4, 1), observed: number[] = [];
  assert.sameValue(data.buffer, buffer);
  assert.sameValue(data.byteOffset, 4);
  assert.sameValue(data.byteLength, 4);
  for (let i = 0; i < data.length; i++) observed[i] = localGet(data, i);
  assert.compareArray(observed, [0]);
}
checkWindow<WindowInput>({ offset: 2, size: 1 });
checkWindow<NamedWindowInput>({ offset: 6, size: 0, label: "late misalignment" });
console.log("construction-layout-window-misaligned-generic:ok");
