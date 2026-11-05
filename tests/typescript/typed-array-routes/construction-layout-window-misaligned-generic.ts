/*---
description: Misaligned Int32 offsets throw while an aligned neighbor succeeds.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-generics, ts-errors]
---*/
// Misaligned Int32 offsets throw while an aligned neighbor succeeds. Route: constrained helper at two type arguments.
// Node prints construction-layout-window-misaligned-generic:ok after exact observations.
type BufferStorage = ArrayBuffer;
type WindowInput = { offset: number; size: number };
type NamedWindowInput = { offset: number; size: number; label: string };
function checkWindow<T extends WindowInput>(input: T): void {
  const buffer: BufferStorage = new ArrayBuffer(8);
  assert.throws(RangeError, () => new Int32Array(buffer, input.offset, input.size));
  const data = new Int32Array(buffer, 4, 1), observed: number[] = [];
  assert.sameValue(data.buffer, buffer);
  assert.sameValue(data.byteOffset, 4);
  assert.sameValue(data.byteLength, 4);
  for (let i = 0; i < data.length; i++) observed[i] = data[i];
  assert.compareArray(observed, [0]);
}
checkWindow<WindowInput>({ offset: 2, size: 1 });
checkWindow<NamedWindowInput>({ offset: 6, size: 0, label: "late misalignment" });
console.log("construction-layout-window-misaligned-generic:ok");
