/*---
description: "Uint8 accepts the last window byte and rejects negative or nonfitting accesses without changing any backing byte."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-map-set, ts-strings, ts-narrowing]
---*/

// Uint8 accepts the last window byte and rejects negative or nonfitting accesses without changing any backing byte. Route: a fixed window retrieved through guarded Map.get. Node prints views-access-uint8-map-window-bounds:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i); return bytes; }
const seed: readonly number[] = [11, 22, 33, 44, 55, 66, 77, 88];
const rows: readonly [number, readonly number[]][] = [[127, [11, 22, 33, 44, 127, 66, 77, 88]], [255, [11, 22, 33, 44, 255, 66, 77, 88]]];
for (const [value, expected] of rows) {
  const buffer: BufferStorage = new ArrayBuffer(8), whole: View = new DataView(buffer);
  for (let i = 0; i < seed.length; i++) whole.setUint8(i, seed[i]);
  const views: Map<string, View> = new Map([["payload", new DataView(buffer, 2, 3)]]), selected = views.get("payload");
  if (selected === undefined) throw new Error("missing window");
  selected.setUint8(2, value); assert.sameValue(selected.getUint8(2), value); assert.compareArray(readBytes(whole), expected);
  for (const offset of [-1, -1.9, 3, 3.9, 4]) {
    assert.throws(RangeError, () => selected.getUint8(offset)); assert.throws(RangeError, () => selected.setUint8(offset, value));
    assert.compareArray(readBytes(whole), expected);
  }
}
console.log("views-access-uint8-map-window-bounds:ok");
