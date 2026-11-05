/*---
description: "Constructor offsets below zero or beyond a four byte buffer throw while valid offsets retain their remaining lengths through a constrained generic at two object type arguments. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-generics, ts-generic-constraints, ts-objects, ts-strings, ts-arrow-functions, ts-errors]
---*/

interface LocalView { buffer: number[]; byteOffset: number; byteLength: number; }
function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], offset: number = 0, length: number = buffer.length - offset): LocalView {
  if (offset < 0 || length < 0 || offset + length > buffer.length) throw new RangeError();
  return { buffer, byteOffset: offset, byteLength: length };
}
function localGetUint8(view: LocalView, offset: number): number { if (offset < 0 || offset >= view.byteLength) throw new RangeError(); return view.buffer[view.byteOffset + offset]; }
// Constructor offsets below zero or beyond a four byte buffer throw while valid offsets retain their remaining lengths; route: a constrained generic at two object type arguments. Node prints views-window-invalid-offsets-generic:ok.
type BufferStorage = number[];
type View = LocalView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = localGetUint8(view, i); return result;
}
const backing: BufferStorage = localArrayBuffer(4), whole: View = localDataView(backing);
type NumberOffset = { offset: number; label: number };
type TextOffset = { offset: number; label: string };
function openWindow<T extends { offset: number }>(packet: T): View { return localDataView(backing, packet.offset); }
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
