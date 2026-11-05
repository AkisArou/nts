/*---
description: "Transfer to a shorter length preserves exactly the requested prefix through a constrained helper at plain and named request types."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-generics, ts-generic-constraints, ts-readonly, ts-strings]
---*/

// Transfer to a shorter length preserves exactly the requested prefix; route: a constrained helper at plain and named request types.
// Node prints buffers-transfer-shrink-generic-prefix:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function inspect<T extends { length: number; expected: readonly number[] }>(request: T): void {
  const buffer: BufferStorage = new ArrayBuffer(4), before: View = new DataView(buffer);
  for (let i = 0; i < 4; i++) before.setUint8(i, 10 * (i + 1));
  const moved = buffer.transfer(request.length), view: View = new DataView(moved);
  assert.sameValue(buffer.detached, true); assert.sameValue(moved.byteLength, request.length);
  const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, request.expected);
}
inspect<{ length: number; expected: readonly number[] }>({ length: 1, expected: [10] });
inspect<{ length: number; expected: readonly number[]; name: string }>({ length: 3, expected: [10, 20, 30], name: "prefix" });
console.log("buffers-transfer-shrink-generic-prefix:ok");
