/*---
description: "Map-held offset views and a whole-buffer byte alias observe writes in both directions at their shared indices through views obtained through guarded Map lookups."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-map-set, ts-strings, ts-narrowing, ts-null-undefined, ts-errors, ts-readonly, ts-tuples, ts-destructuring]
---*/

type LocalView = { buffer: number[]; byteOffset: number; byteLength: number };
function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], byteOffset = 0, byteLength = buffer.length - byteOffset): LocalView { return { buffer, byteOffset, byteLength }; }
function localGetUint8(view: LocalView, offset: number): number { return view.buffer[view.byteOffset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { view.buffer[view.byteOffset + offset] = value; }
function localUint8Array(buffer: number[]): number[] { return buffer; }

// Map-held offset views and a whole-buffer byte alias observe writes in both directions at their shared indices; route: views obtained through guarded Map lookups.
// Node prints views-sharing-map-byte-alias:ok.
type BufferStorage = number[];
type View = LocalView;
type Bytes = number[];
const buffer: BufferStorage = localArrayBuffer(8), bytes: Bytes = localUint8Array(buffer), whole: View = localDataView(buffer);
const views: Map<string, View> = new Map([["first", localDataView(buffer, 1, 4)], ["second", localDataView(buffer, 3, 4)]]);
const rows: readonly [string, number, number, number][] = [["first", 2, 3, 127], ["second", 3, 6, 255]];
for (const [key, relative, absolute, value] of rows) {
  const view = views.get(key); if (view === undefined) throw new Error("missing view");
  bytes[absolute] = value; assert.sameValue(localGetUint8(view, relative), value);
  localSetUint8(view, relative, value - 1); assert.sameValue(bytes[absolute], value - 1);
  assert.sameValue(view.buffer === buffer, true);
}
const observed: number[] = []; for (let i = 0; i < 8; i++) observed[i] = localGetUint8(whole, i);
assert.compareArray(observed, [0, 0, 0, 126, 0, 0, 254, 0]);
console.log("views-sharing-map-byte-alias:ok");
