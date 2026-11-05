/*---
description: "Map-held offset views and a whole-buffer byte alias observe writes in both directions at their shared indices through views obtained through guarded Map lookups."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-map-set, ts-strings, ts-narrowing, ts-null-undefined, ts-errors, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Map-held offset views and a whole-buffer byte alias observe writes in both directions at their shared indices; route: views obtained through guarded Map lookups.
// Node prints views-sharing-map-byte-alias:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
type Bytes = Uint8Array<ArrayBuffer>;
const buffer: BufferStorage = new ArrayBuffer(8), bytes: Bytes = new Uint8Array(buffer), whole: View = new DataView(buffer);
const views: Map<string, View> = new Map([["first", new DataView(buffer, 1, 4)], ["second", new DataView(buffer, 3, 4)]]);
const rows: readonly [string, number, number, number][] = [["first", 2, 3, 127], ["second", 3, 6, 255]];
for (const [key, relative, absolute, value] of rows) {
  const view = views.get(key); if (view === undefined) throw new Error("missing view");
  bytes[absolute] = value; assert.sameValue(view.getUint8(relative), value);
  view.setUint8(relative, value - 1); assert.sameValue(bytes[absolute], value - 1);
  assert.sameValue(view.buffer === buffer, true);
}
const observed: number[] = []; for (let i = 0; i < 8; i++) observed[i] = whole.getUint8(i);
assert.compareArray(observed, [0, 0, 0, 126, 0, 0, 254, 0]);
console.log("views-sharing-map-byte-alias:ok");
