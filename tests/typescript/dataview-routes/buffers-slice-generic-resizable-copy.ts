/*---
description: "A slice of a resizable buffer is fixed and survives the source shrinking to zero through a constrained range helper at two type arguments."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-generics, ts-generic-constraints, ts-readonly, ts-strings]
---*/

// A slice of a resizable buffer is fixed and survives the source shrinking to zero; route: a constrained range helper at two type arguments.
// Node prints buffers-slice-generic-resizable-copy:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function inspect<T extends { start: number; end: number; expected: readonly number[] }>(field: T): void {
  const source: BufferStorage = new ArrayBuffer(4, { maxByteLength: 8 }), before: View = new DataView(source);
  for (let i = 0; i < 4; i++) before.setUint8(i, 10 * (i + 1));
  const copy = source.slice(field.start, field.end), view: View = new DataView(copy);
  assert.sameValue(copy.resizable, false); assert.sameValue(copy.maxByteLength, field.expected.length);
  source.resize(0); assert.sameValue(view.byteLength, field.expected.length);
  const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, field.expected);
}
inspect<{ start: number; end: number; expected: readonly number[] }>({ start: 0, end: 2, expected: [10, 20] });
inspect<{ start: number; end: number; expected: readonly number[]; name: string }>({ start: 2, end: 4, expected: [30, 40], name: "tail" });
console.log("buffers-slice-generic-resizable-copy:ok");
