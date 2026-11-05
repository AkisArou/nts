/*---
description: Windows beyond the buffer throw while both widths admit an empty end window.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-class, ts-interfaces, ts-readonly, ts-tuples, ts-errors]
---*/
type LocalView = { buffer: number[]; byteOffset: number; length: number; byteLength: number; elementWidth: number };
function localArrayBuffer(size: number): number[] { const values: number[] = []; for (let i = 0; i < size; i++) values[i] = 0; return values; }
function localWindow(buffer: number[], offset: number, size: number | undefined, width: number): LocalView {
  const start = Number.isNaN(offset) ? 0 : Math.trunc(offset), length = size === undefined ? (buffer.length - start) / width : Number.isNaN(size) ? 0 : Math.trunc(size);
  if (!Number.isFinite(start) || start < 0 || start % width !== 0 || !Number.isInteger(length) || length < 0 || start + length * width > buffer.length) throw new RangeError();
  return { buffer, byteOffset: start, length, byteLength: length * width, elementWidth: width };
}
function localGet(view: LocalView, index: number): number { return view.buffer[view.byteOffset + index * view.elementWidth]; }
function localInt16Array(buffer: number[], offset = 0, size?: number): LocalView { return localWindow(buffer, offset, size, 2); }
function localInt32Array(buffer: number[], offset = 0, size?: number): LocalView { return localWindow(buffer, offset, size, 4); }
// Windows beyond the buffer throw while both widths admit an empty end window. Route: two window factory interface implementations.
// Node prints construction-layout-window-overlong-interface:ok after exact observations.
type BufferStorage = number[];
type Samples = LocalView;
interface WindowFactory { make(buffer: BufferStorage, offset: number, size: number): Samples; }
class NarrowFactory implements WindowFactory { make(buffer: BufferStorage, offset: number, size: number): Samples { return localInt16Array(buffer, offset, size); } }
class WideFactory implements WindowFactory { make(buffer: BufferStorage, offset: number, size: number): Samples { return localInt32Array(buffer, offset, size); } }
const rows: readonly [WindowFactory, number, number, number][] = [[new NarrowFactory(), 6, 2, 2], [new WideFactory(), 4, 2, 4], [new NarrowFactory(), 8, 1, 2], [new WideFactory(), 12, 0, 4]];
for (const [factory, offset, size, width] of rows) {
  const buffer: BufferStorage = localArrayBuffer(8);
  const fitted = factory.make(buffer, 0, 1); assert.sameValue(fitted.byteLength, width);
  assert.throws(RangeError, () => factory.make(buffer, offset, size));
  const data = factory.make(buffer, 8, 0), observed: number[] = [];
  assert.sameValue(data.buffer, buffer);
  assert.sameValue(data.byteOffset, 8);
  assert.sameValue(data.length, 0);
  assert.sameValue(data.byteLength, 0);
  for (let i = 0; i < data.length; i++) observed[i] = localGet(data, i);
  assert.compareArray(observed, []);
}
console.log("construction-layout-window-overlong-interface:ok");
