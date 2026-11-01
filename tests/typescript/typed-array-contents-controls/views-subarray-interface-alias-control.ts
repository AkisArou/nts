/*---
description: Control for views-subarray-interface-alias; the tested view stays in a local variable of its exact type.
features: [ts-typed-array-contents, ts-typed-array-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-interfaces, ts-objects]
---*/
// Replace the interface-held parent with one local Uint8Array; subarray creation, writes and assertions are unchanged.
function check(n: number): void {
  const view: Uint8Array = new Uint8Array(new ArrayBuffer(9), 2, 5);
  for (let i = 0; i < 5; i++) view[i] = n + i;
  const part: Uint8Array = view.subarray(1, 4);
  part[0] = -1; part[1] = n + 256; view[3] = 255;
  assert.sameValue(part.buffer, view.buffer);
  assert.sameValue(view.length, 5); assert.sameValue(view.byteOffset, 2); assert.sameValue(view.byteLength, 5);
  assert.sameValue(part.length, 3); assert.sameValue(part.byteOffset, 3); assert.sameValue(part.byteLength, 3);
  const expected: number[] = [n, 255, n, 255, n + 4], partial: number[] = [255, n, 255];
  for (let i = 0; i < 5; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
  for (let i = 0; i < 3; i++) assert.sameValue(Object.is(part[i], partial[i]), true);
  const bytes: Uint8Array = new Uint8Array(view.buffer), raw: number[] = [0, 0, n, 255, n, 255, n + 4, 0, 0];
  assert.sameValue(bytes.length, 9); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.byteLength, 9);
  for (let i = 0; i < 9; i++) assert.sameValue(Object.is(bytes[i], raw[i]), true);
}
for (const n of [0, 127, 250]) check(n);
