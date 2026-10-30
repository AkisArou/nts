/*---
description: The late propagated index equals the view length; read is undefined.
features: [ts-proof-bounds, ts-route-chain, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: all 24 indices initially equal 0, inside the four-element value.
// The late propagated index equals the view length; read is undefined.
function read(turns: number): number | undefined {
  const xs = new Int32Array([11, 22, 33, 44]);
  let i0 = 0, i1 = 0, i2 = 0, i3 = 0, i4 = 0, i5 = 0;
  let i6 = 0, i7 = 0, i8 = 0, i9 = 0, i10 = 0, i11 = 0;
  let i12 = 0, i13 = 0, i14 = 0, i15 = 0, i16 = 0, i17 = 0;
  let i18 = 0, i19 = 0, i20 = 0, i21 = 0, i22 = 0, i23 = 0;
  for (let turn = 0; turn < turns; turn++) {
    i23 = i22; i22 = i21; i21 = i20; i20 = i19; i19 = i18; i18 = i17;
    i17 = i16; i16 = i15; i15 = i14; i14 = i13; i13 = i12; i12 = i11;
    i11 = i10; i10 = i9; i9 = i8; i8 = i7; i7 = i6; i6 = i5;
    i5 = i4; i4 = i3; i3 = i2; i2 = i1; i1 = i0;
    i0 = 4;
  }
  return xs[i23];
}
for (const turns of [0, 1, 23, 24, 25, 29]) assert.sameValue(read(turns), turns < 24 ? 11 : undefined);
