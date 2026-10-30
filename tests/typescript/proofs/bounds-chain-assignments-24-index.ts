/*---
description: Index 4 crosses 24 assignments and must read undefined.
features: [ts-proof-bounds, ts-route-chain, ts-functions, ts-iteration, ts-arrays, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: the source index starts at 0 before a 24-assignment dependency.
// Index 4 crosses 24 assignments and must read undefined.
function read(change: number): number | undefined {
  const xs = [11, 22, 33, 44];
  let i0 = 0;
  if (change > 0) i0 = 4;
  const i1 = i0;
  const i2 = i1;
  const i3 = i2;
  const i4 = i3;
  const i5 = i4;
  const i6 = i5;
  const i7 = i6;
  const i8 = i7;
  const i9 = i8;
  const i10 = i9;
  const i11 = i10;
  const i12 = i11;
  const i13 = i12;
  const i14 = i13;
  const i15 = i14;
  const i16 = i15;
  const i17 = i16;
  const i18 = i17;
  const i19 = i18;
  const i20 = i19;
  const i21 = i20;
  const i22 = i21;
  const i23 = i22;
  const i24 = i23;
  return xs[i24];
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 11);
