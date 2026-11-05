/*---
description: "A retained offset view sees zeroes after discarded bytes are grown back through a constrained layout helper at two type arguments."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-generics, ts-generic-constraints, ts-readonly, ts-strings]
---*/

// A retained offset view sees zeroes after discarded bytes are grown back; route: a constrained layout helper at two type arguments.
// Node prints buffers-resize-offset-generic-zeroes:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function inspect<T extends { offset: number; expected: readonly number[] }>(field: T): void {
  const buffer: BufferStorage = new ArrayBuffer(6, { maxByteLength: 8 }), whole: View = new DataView(buffer);
  for (let i = 0; i < 6; i++) whole.setUint8(i, i + 11);
  const view: View = new DataView(buffer, field.offset);
  buffer.resize(field.offset + 1); buffer.resize(8);
  const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, field.expected); assert.sameValue(view.byteOffset, field.offset);
}
inspect<{ offset: number; expected: readonly number[] }>({ offset: 0, expected: [11, 0, 0, 0, 0, 0, 0, 0] });
inspect<{ offset: number; expected: readonly number[]; name: string }>({ offset: 3, expected: [14, 0, 0, 0, 0], name: "tail" });
console.log("buffers-resize-offset-generic-zeroes:ok");
