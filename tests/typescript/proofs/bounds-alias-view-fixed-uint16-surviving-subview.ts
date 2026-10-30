/*---
description: Alias effects on a Uint16Array view: the original fixed subview survives a shrink to 6 bytes and reads a fresh sibling write.
features: [ts-proof-bounds, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the alias route.
// The original fixed subview survives a shrink to 6 bytes and reads a fresh sibling write; node reads 4097 + change after the change, otherwise 50003.
function read(change: number): { value: number; bytes: number } {
  const buffer = new ArrayBuffer(16, { maxByteLength: 20 });
  const view = new Uint16Array(buffer, 2, 2);
  const index = 1;
  view[index] = 50003;
  const holder = { storage: buffer };
  const alias = holder;
  if (index < view.length) {
    if (change > 0) {
      alias.storage.resize(6);
      const sibling = new Uint16Array(buffer, 2, 2);
      sibling[index] = 4097 + change;
    }
    return { value: view[index], bytes: buffer.byteLength };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? 4097 + change : 50003);
  assert.sameValue(result.bytes, change > 0 ? 6 : 16);
}
