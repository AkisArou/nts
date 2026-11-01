/*---
description: A union-typed byte writer and signed sibling share converted bytes at a nonzero offset.
features: [ts-typed-array-contents, ts-typed-array-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-unions, ts-tuples]
---*/
// Write through a Uint8Array union parameter; read signed and raw-byte siblings; node exposes the same three bytes.
function check(view: Uint8Array | Uint8ClampedArray, n: number, byte: number, sign: number): void {
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
for (const [n, byte, sign] of rows) check(new Uint8Array(new ArrayBuffer(8), 2, 3), n, byte, sign);
