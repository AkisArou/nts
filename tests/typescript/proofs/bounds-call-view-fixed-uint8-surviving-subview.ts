/*---
description: Call effects on a Uint8Array view: the original fixed subview survives a shrink to 3 bytes and reads a fresh sibling write.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-closures]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the call route.
// The original fixed subview survives a shrink to 3 bytes and reads a fresh sibling write; node reads 31 + change after the change, otherwise 173.
function read(change: number): { value: number; bytes: number } {
  const buffer = new ArrayBuffer(8, { maxByteLength: 10 });
  const view = new Uint8Array(buffer, 1, 2);
  const index = 1;
  view[index] = 173;
  function update(): void {
    if (change > 0) {
      buffer.resize(3);
      const sibling = new Uint8Array(buffer, 1, 2);
      sibling[index] = 31 + change;
    }
  }
  function relay(): void { update(); }
  if (index < view.length) {
    relay();
    return { value: view[index], bytes: buffer.byteLength };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? 31 + change : 173);
  assert.sameValue(result.bytes, change > 0 ? 3 : 8);
}
