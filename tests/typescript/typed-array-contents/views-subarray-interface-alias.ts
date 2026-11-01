/*---
description: A subarray made from an interface-held offset view sees writes in both directions.
features: [ts-typed-array-contents, ts-typed-array-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-interfaces, ts-objects]
---*/
// Write the interface-held parent and its subarray; node aliases their overlapping bytes with the composed offset.
interface ContentsByteSlot { view: Uint8Array; }
function check(n: number): void {
  const slot: ContentsByteSlot = { view: new Uint8Array(new ArrayBuffer(9), 2, 5) };
  for (let i = 0; i < 5; i++) slot.view[i] = n + i;
  const part: Uint8Array = slot.view.subarray(1, 4);
  part[0] = -1; part[1] = n + 256; slot.view[3] = 255;
  assert.sameValue(part.buffer, slot.view.buffer);
  assert.sameValue(slot.view.length, 5); assert.sameValue(slot.view.byteOffset, 2); assert.sameValue(slot.view.byteLength, 5);
  assert.sameValue(part.length, 3); assert.sameValue(part.byteOffset, 3); assert.sameValue(part.byteLength, 3);
  const expected: number[] = [n, 255, n, 255, n + 4], partial: number[] = [255, n, 255];
  for (let i = 0; i < 5; i++) assert.sameValue(Object.is(slot.view[i], expected[i]), true);
  for (let i = 0; i < 3; i++) assert.sameValue(Object.is(part[i], partial[i]), true);
  const bytes: Uint8Array = new Uint8Array(slot.view.buffer), raw: number[] = [0, 0, n, 255, n, 255, n + 4, 0, 0];
  assert.sameValue(bytes.length, 9); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.byteLength, 9);
  for (let i = 0; i < 9; i++) assert.sameValue(Object.is(bytes[i], raw[i]), true);
}
for (const n of [0, 127, 250]) check(n);
