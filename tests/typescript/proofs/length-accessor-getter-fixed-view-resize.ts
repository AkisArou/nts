/*---
description: A getter can make an entire fixed view out of bounds by shrinking its buffer.
features: [ts-proof-length, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-accessors, ts-objects, ts-numbers]
---*/
// Fact: the fixed view length is 4 (docs/foundations/objects.md, Typed arrays).
// Route: a getter shrinks below its extent; node reads 0, even at byte offset 0.
function fixedLengthAfterGetter(bytes: number): number {
  const buffer = new ArrayBuffer(8, { maxByteLength: 8 });
  const view = new Uint8Array(buffer, 0, 4);
  const hook = {
    get touch(): number {
      buffer.resize(bytes);
      return 0;
    }
  };
  hook.touch;
  return view.length;
}
for (const n of [0, 1, 3, 4, 7, 8]) {
  assert.sameValue(fixedLengthAfterGetter(n), n < 4 ? 0 : 4);
}
