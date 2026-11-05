/*---
description: "Constructor offsets below zero or beyond a four byte buffer throw while valid offsets retain their remaining lengths through a constrained generic at two object type arguments."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-generics, ts-generic-constraints, ts-objects, ts-strings, ts-arrow-functions, ts-errors]
---*/

// Constructor offsets below zero or beyond a four byte buffer throw while valid offsets retain their remaining lengths; route: a constrained generic at two object type arguments. Node prints views-window-invalid-offsets-generic:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
const backing: BufferStorage = new ArrayBuffer(4), whole: View = new DataView(backing);
type NumberOffset = { offset: number; label: number };
type TextOffset = { offset: number; label: string };
function openWindow<T extends { offset: number }>(packet: T): View { return new DataView(backing, packet.offset); }
for (const offset of [-1, 5, Infinity]) {
  assert.throws(RangeError, () => openWindow<NumberOffset>({ offset, label: 7 }));
  assert.throws(RangeError, () => openWindow<TextOffset>({ offset, label: "second" }));
  assert.compareArray(readBytes(whole), [0, 0, 0, 0]);
}
for (const offset of [0, 2, 4]) {
  const first = openWindow<NumberOffset>({ offset, label: 7 }), second = openWindow<TextOffset>({ offset, label: "second" });
  assert.compareArray([first.byteOffset, first.byteLength, second.byteOffset, second.byteLength], [offset, 4 - offset, offset, 4 - offset]);
  assert.sameValue(first.buffer, backing); assert.sameValue(second.buffer, backing);
}
console.log("views-window-invalid-offsets-generic:ok");
