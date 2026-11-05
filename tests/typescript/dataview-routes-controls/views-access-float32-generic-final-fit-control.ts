/*---
description: "A one-word Float32 window accepts offset zero and rejects later offsets even when the complete access fits its backing buffer. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-generics, ts-generic-constraints, ts-strings]
---*/

type LocalView = { buffer: number[]; offset: number; length: number };
function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], offset = 0, length = buffer.length - offset): LocalView { return { buffer, offset, length }; }
function localByteLength(view: LocalView): number { return view.length; }
function localIndex(view: LocalView, offset: number, width: number): number {
  if (offset === Infinity || offset === -Infinity) throw new RangeError(); offset = offset !== offset ? 0 : offset - offset % 1;
  if (offset < 0 || offset + width > view.length) throw new RangeError(); return view.offset + offset;
}
function localGetUint8(view: LocalView, offset: number): number { return view.buffer[localIndex(view, offset, 1)]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { view.buffer[localIndex(view, offset, 1)] = value; }
const localFloat32: readonly [number, readonly number[]][] = [[1.5, [63, 192, 0, 0]], [-2.5, [192, 32, 0, 0]]];
function localGetFloat32(view: LocalView, offset: number, little = false): number {
  const start = localIndex(view, offset, 4); for (const [value, bytes] of localFloat32) { let matches = true; for (let i = 0; i < 4; i++) if (view.buffer[start + i] !== bytes[little ? 3 - i : i]) matches = false; if (matches) return value; }
  throw new RangeError("unlisted bytes"); }
function localSetFloat32(view: LocalView, offset: number, value: number, little = false): void {
  const start = localIndex(view, offset, 4); for (const [input, bytes] of localFloat32) if (Object.is(value, input)) { for (let i = 0; i < 4; i++) view.buffer[start + i] = bytes[little ? 3 - i : i]; return; }
  throw new RangeError("unlisted value"); }
// A one-word Float32 window accepts offset zero and rejects later offsets even when the complete access fits its backing buffer. Route: a constrained window request at plain and named type arguments. Node prints views-access-float32-generic-final-fit:ok.
type BufferStorage = number[];
type View = LocalView;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < localByteLength(view); i++) bytes[i] = localGetUint8(view, i); return bytes; }
function inspect<T extends { value: number; expected: readonly number[] }>(request: T): void {
  const buffer: BufferStorage = localArrayBuffer(12), whole: View = localDataView(buffer), view: View = localDataView(buffer, 3, 4);
  for (let i = 0; i < 12; i++) localSetUint8(whole, i, 90);
  localSetFloat32(view, 0, request.value, true); assert.sameValue(localGetFloat32(view, 0, true), request.value); assert.compareArray(readBytes(whole), request.expected);
  for (const offset of [1, 4, 9]) {
    assert.throws(RangeError, () => localGetFloat32(view, offset, true));
    assert.throws(RangeError, () => localSetFloat32(view, offset, request.value, true)); assert.compareArray(readBytes(whole), request.expected);
  }
}
const rows: readonly [number, readonly number[]][] = [[1.5, [90, 90, 90, 0, 0, 192, 63, 90, 90, 90, 90, 90]], [-2.5, [90, 90, 90, 0, 0, 32, 192, 90, 90, 90, 90, 90]]];
for (const [value, expected] of rows) {
  inspect<{ value: number; expected: readonly number[] }>({ value, expected });
  inspect<{ value: number; expected: readonly number[]; label: string }>({ value, expected, label: "window" });
}
console.log("views-access-float32-generic-final-fit:ok");
