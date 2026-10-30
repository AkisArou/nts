/*---
description: A fixed view loses and regains its length across called buffer resizes.
features: [ts-proof-length, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: a fixed view has length 4 (docs/foundations/objects.md, Typed arrays).
// Route: calls shrink then regrow its buffer; node sees 4, 0, 4 or 4, 4, 4.
function resizeTo(buffer: ArrayBuffer, bytes: number): void {
  buffer.resize(bytes);
}
function lengthsAcrossCalls(bytes: number): number {
  const buffer = new ArrayBuffer(8, { maxByteLength: 8 });
  const view = new Uint8Array(buffer, 0, 4);
  const before = view.length;
  resizeTo(buffer, bytes);
  const shrunken = view.length;
  resizeTo(buffer, 8);
  return before * 100 + shrunken * 10 + view.length;
}
for (const n of [0, 1, 3, 4, 7, 8]) {
  assert.sameValue(lengthsAcrossCalls(n), n < 4 ? 404 : 444);
}
