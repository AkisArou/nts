/*---
description: Control for views-signed-bytes-union-parameter; the tested view stays in a local variable of its exact type.
features: [ts-typed-array-contents, ts-typed-array-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-unions, ts-tuples]
---*/
// Move only the tested view allocation into check as a local Uint8Array; writes and assertions are unchanged.
function check(n: number, byte: number, sign: number): void {
  const view: Uint8Array = new Uint8Array(new ArrayBuffer(8), 2, 3);
  const other: Int8Array = new Int8Array(view.buffer, 2, 3);
  view[0] = n; other[1] = -1; view[2] = 256;
  const expected: number[] = [byte, 255, 0], signed: number[] = [sign, -1, 0];
  assert.sameValue(view.length, 3); assert.sameValue(view.byteOffset, 2); assert.sameValue(view.byteLength, 3);
  assert.sameValue(other.length, 3); assert.sameValue(other.byteOffset, 2); assert.sameValue(other.byteLength, 3);
  for (let i = 0; i < 3; i++) {
    assert.sameValue(Object.is(view[i], expected[i]), true);
    assert.sameValue(Object.is(other[i], signed[i]), true);
  }
  const raw: Uint8Array = new Uint8Array(view.buffer), bytes: number[] = [0, 0, byte, 255, 0, 0, 0, 0];
  assert.sameValue(raw.length, 8); assert.sameValue(raw.byteOffset, 0); assert.sameValue(raw.byteLength, 8);
  for (let i = 0; i < 8; i++) assert.sameValue(Object.is(raw[i], bytes[i]), true);
}
const rows: [number, number, number][] = [[-129, 127, 127], [-1, 255, -1], [128, 128, -128], [256, 0, 0]];
for (const [n, byte, sign] of rows) check(n, byte, sign);
