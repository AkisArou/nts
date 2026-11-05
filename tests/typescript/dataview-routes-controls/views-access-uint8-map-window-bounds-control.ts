/*---
description: "Uint8 accepts the last window byte and rejects negative or nonfitting accesses without changing any backing byte. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-map-set, ts-strings, ts-narrowing]
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
// Uint8 accepts the last window byte and rejects negative or nonfitting accesses without changing any backing byte. Route: a fixed window retrieved through guarded Map.get. Node prints views-access-uint8-map-window-bounds:ok.
type BufferStorage = number[];
type View = LocalView;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < localByteLength(view); i++) bytes[i] = localGetUint8(view, i); return bytes; }
const seed: readonly number[] = [11, 22, 33, 44, 55, 66, 77, 88];
const rows: readonly [number, readonly number[]][] = [[127, [11, 22, 33, 44, 127, 66, 77, 88]], [255, [11, 22, 33, 44, 255, 66, 77, 88]]];
for (const [value, expected] of rows) {
  const buffer: BufferStorage = localArrayBuffer(8), whole: View = localDataView(buffer);
  for (let i = 0; i < seed.length; i++) localSetUint8(whole, i, seed[i]);
  const views: Map<string, View> = new Map([["payload", localDataView(buffer, 2, 3)]]), selected = views.get("payload");
  if (selected === undefined) throw new Error("missing window");
  localSetUint8(selected, 2, value); assert.sameValue(localGetUint8(selected, 2), value); assert.compareArray(readBytes(whole), expected);
  for (const offset of [-1, -1.9, 3, 3.9, 4]) {
    assert.throws(RangeError, () => localGetUint8(selected, offset)); assert.throws(RangeError, () => localSetUint8(selected, offset, value));
    assert.compareArray(readBytes(whole), expected);
  }
}
console.log("views-access-uint8-map-window-bounds:ok");
