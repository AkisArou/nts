/*---
description: A typed-array callback resizes the buffer of a tracking target view.
features: [ts-proof-length, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-arrow-functions, ts-numbers]
---*/
// Fact: the target length is 4 (docs/foundations/objects.md, Typed arrays).
// Route: forEach resizes its buffer; node reads n through the target view.
function lengthAfterViewCallback(n: number): number {
  const steps = new Uint8Array([0, 1]);
  const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
  const view = new Uint16Array(buffer);
  steps.forEach(step => {
    if (step === 0 && n !== 4) buffer.resize(n * 2);
  });
  return view.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterViewCallback(n), n);
}
