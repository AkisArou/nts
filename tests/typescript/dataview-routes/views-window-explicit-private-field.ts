/*---
description: "An explicit length selects exactly its window including interior and end empty windows through a private buffer field."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-private-fields, ts-destructuring]
---*/

// An explicit length selects exactly its window including interior and end empty windows; route: a private buffer field. Node prints views-window-explicit-private-field:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
function makeBuffer(input: readonly number[]): BufferStorage {
  const buffer: BufferStorage = new ArrayBuffer(input.length), view: View = new DataView(buffer);
  for (let i = 0; i < input.length; i++) view.setUint8(i, input[i]);
  return buffer;
}
class WindowBox {
  #storage: BufferStorage;
  constructor(input: readonly number[]) { this.#storage = makeBuffer(input); }
  open(offset: number, length: number): View { return new DataView(this.#storage, offset, length); }
  storage(): BufferStorage { return this.#storage; }
}
const box: WindowBox = new WindowBox([9, 18, 27, 36, 45, 54, 63, 72]);
const rows: readonly [number, number, readonly number[]][] = [[1, 3, [18, 27, 36]], [2, 2, [27, 36]], [5, 0, []], [8, 0, []]];
for (const [offset, length, expected] of rows) {
  const view: View = box.open(offset, length);
  assert.sameValue(view.byteOffset, offset); assert.sameValue(view.byteLength, length);
  assert.sameValue(view.buffer, box.storage()); assert.compareArray(readBytes(view), expected);
}
console.log("views-window-explicit-private-field:ok");
