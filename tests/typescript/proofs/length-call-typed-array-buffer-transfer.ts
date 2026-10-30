/*---
description: A called buffer transfer invalidates the old view length.
features: [ts-proof-length, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: the view has length 4 (docs/foundations/objects.md, Typed arrays).
// Route: a callee detaches its buffer; node reads 0 on the old view.
function transferIf(buffer: ArrayBuffer, detach: boolean): void {
  if (detach) buffer.transfer();
}
function lengthAfterTransferCall(n: number): number {
  const buffer = new ArrayBuffer(8);
  const view = new Uint16Array(buffer);
  transferIf(buffer, n > 0);
  return view.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterTransferCall(n), n > 0 ? 0 : 4);
}
