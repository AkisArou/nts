/*---
description: A tracking view changes length when later loop iterations resize its buffer.
features: [ts-proof-length, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: Uint16Array starts at length 4 (docs/foundations/objects.md, Typed arrays).
// Route: loop resizes change its buffer; node reads turns after a nonempty loop.
function trackingLengthAfterLoop(turns: number): number {
  const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
  const view = new Uint16Array(buffer);
  for (let i = 0; i < turns; i++) buffer.resize((i + 1) * 2);
  return view.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(trackingLengthAfterLoop(n), n === 0 ? 4 : n);
}
