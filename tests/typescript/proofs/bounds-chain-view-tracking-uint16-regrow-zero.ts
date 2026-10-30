/*---
description: Chain effects on a Uint16Array view: shrink then growth to 16 bytes restores a valid index with zeroed lost bytes.
features: [ts-proof-bounds, ts-route-chain, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the chain route.
// Shrink then growth to 16 bytes restores a valid index with zeroed lost bytes; node reads 0 after the change, otherwise 50003.
function read(change: number): number {
  const buffer = new ArrayBuffer(12, { maxByteLength: 20 });
  const view = new Uint16Array(buffer, 4);
  const index = 2;
  view[index] = 50003;
  if (index < view.length) {
    const a0 = view; const a1 = a0; const a2 = a1; const a3 = a2;
    const a4 = a3; const a5 = a4; const a6 = a5; const a7 = a6;
    const a8 = a7; const a9 = a8; const a10 = a9; const a11 = a10;
    const a12 = a11; const a13 = a12; const a14 = a13; const a15 = a14;
    const a16 = a15; const a17 = a16; const a18 = a17; const a19 = a18;
    const a20 = a19; const a21 = a20; const a22 = a21; const a23 = a22;
    const a24 = a23;
    if (change > 0) {
      a24.buffer.resize(6);
      a24.buffer.resize(16);
    }
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? 0 : 50003);
}
