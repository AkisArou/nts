/*---
description: Chain effects on an Int32Array view: shrinking to 19 bytes invalidates the whole fixed view although the indexed bytes survive.
features: [ts-proof-bounds, ts-route-chain, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the chain route.
// Shrinking to 19 bytes invalidates the whole fixed view although the indexed bytes survive; node reads undefined after the change, otherwise -123456789.
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(32, { maxByteLength: 40 });
  const view = new Int32Array(buffer, 8, 3);
  const index = 1;
  view[index] = -123456789;
  if (index < view.length) {
    const a0 = buffer; const a1 = a0; const a2 = a1; const a3 = a2;
    const a4 = a3; const a5 = a4; const a6 = a5; const a7 = a6;
    const a8 = a7; const a9 = a8; const a10 = a9; const a11 = a10;
    const a12 = a11; const a13 = a12; const a14 = a13; const a15 = a14;
    const a16 = a15; const a17 = a16; const a18 = a17; const a19 = a18;
    const a20 = a19; const a21 = a20; const a22 = a21; const a23 = a22;
    const a24 = a23;
    if (change > 0) {
      a24.resize(19);
    }
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? undefined : -123456789);
}
