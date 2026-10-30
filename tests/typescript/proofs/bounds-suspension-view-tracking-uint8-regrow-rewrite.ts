/*---
description: Suspension effects on a Uint8Array view: shrink then growth to 8 bytes restores a valid index with zeroed lost bytes.
features: [ts-proof-bounds, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-generators, ts-closures, ts-null-undefined]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the suspension route.
// Shrink then growth to 8 bytes restores a valid index with zeroed lost bytes; node reads 31 + change after the change, otherwise 173.
function read(change: number): { value: number; yielded: number | undefined; done: boolean } {
  const buffer = new ArrayBuffer(6, { maxByteLength: 10 });
  const view = new Uint8Array(buffer, 2);
  const index = 2;
  view[index] = 173;
  function* steps(): Generator<number, number, void> {
    if (index < view.length) {
      yield 4;
      return view[index];
    }
    return -999;
  }
  const iterator = steps();
  const first = iterator.next();
  if (change > 0) {
    buffer.resize(3);
    buffer.resize(8);
    view[index] += 31 + change;
  }
  const last = iterator.next();
  return { value: last.value, yielded: first.value, done: last.done === true };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? 31 + change : 173);
  assert.sameValue(result.yielded, 4);
  assert.sameValue(result.done, true);
}
