/*---
description: Chain effects on a Float64Array view: the original fixed subview survives a shrink to 24 bytes and reads a fresh sibling write.
features: [ts-proof-bounds, ts-route-chain, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the chain route.
// The original fixed subview survives a shrink to 24 bytes and reads a fresh sibling write; node reads -2.25 - change after the change, otherwise -12.5.
function read(change: number): { value: number; bytes: number } {
  const buffer = new ArrayBuffer(64, { maxByteLength: 80 });
  const view = new Float64Array(buffer, 8, 2);
  const index = 1;
  view[index] = -12.5;
  if (index < view.length) {
    const a0 = view; const a1 = a0; const a2 = a1; const a3 = a2;
    const a4 = a3; const a5 = a4; const a6 = a5; const a7 = a6;
    const a8 = a7; const a9 = a8; const a10 = a9; const a11 = a10;
    const a12 = a11; const a13 = a12; const a14 = a13; const a15 = a14;
    const a16 = a15; const a17 = a16; const a18 = a17; const a19 = a18;
    const a20 = a19; const a21 = a20; const a22 = a21; const a23 = a22;
    const a24 = a23;
    if (change > 0) {
      a24.buffer.resize(24);
      const sibling = new Float64Array(buffer, 8, 2);
      sibling[index] = -2.25 - change;
    }
    return { value: view[index], bytes: buffer.byteLength };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? -2.25 - change : -12.5);
  assert.sameValue(result.bytes, change > 0 ? 24 : 64);
}
