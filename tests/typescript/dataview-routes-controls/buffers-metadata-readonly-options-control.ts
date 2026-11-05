/*---
description: "Plain and resizable buffers expose their exact initial length maximum and resize flag through readonly tuples of constructor options. (control)"
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-readonly, ts-tuples, ts-unions, ts-null-undefined]
---*/

type LocalBuffer = { bytes: number[]; max: number; grow: boolean; detached: boolean };
type LocalView = { buffer: LocalBuffer; offset: number; length: number | undefined };
function localArrayBuffer(length: number, options?: { maxByteLength: number }): LocalBuffer {
  const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0;
  return { bytes, max: options === undefined ? length : options.maxByteLength, grow: options !== undefined, detached: false }; }
function localDataView(buffer: LocalBuffer, offset: number = 0, length?: number): LocalView {
  if (buffer.detached) throw new TypeError("detached"); if (offset < 0 || offset > buffer.bytes.length || length !== undefined && (length < 0 || offset + length > buffer.bytes.length)) throw new RangeError("window");
  return { buffer, offset, length };
}
function localByteLength(view: LocalView): number {
  if (view.buffer.detached || view.offset > view.buffer.bytes.length || view.length !== undefined && view.offset + view.length > view.buffer.bytes.length) throw new TypeError("out of bounds");
  return view.length === undefined ? view.buffer.bytes.length - view.offset : view.length; }
// Plain and resizable buffers expose their exact initial length maximum and resize flag; route: readonly tuples of constructor options.
// Node prints buffers-metadata-readonly-options:ok.
type BufferStorage = LocalBuffer;
type View = LocalView;
const rows: readonly [number, number | undefined, boolean, number][] = [[0, undefined, false, 0], [4, undefined, false, 4], [0, 8, true, 8], [4, 16, true, 16], [4, 4, true, 4]];
for (const [length, maximum, growable, expectedMaximum] of rows) {
  const buffer: BufferStorage = localArrayBuffer(length, maximum === undefined ? undefined : { maxByteLength: maximum });
  const view: View = localDataView(buffer);
  assert.sameValue(buffer.bytes.length, length); assert.sameValue(buffer.max, expectedMaximum);
  assert.sameValue(buffer.grow, growable); assert.sameValue(buffer.detached, false);
  assert.sameValue(localByteLength(view), length); assert.sameValue(view.buffer === buffer, true);
}
console.log("buffers-metadata-readonly-options:ok");
