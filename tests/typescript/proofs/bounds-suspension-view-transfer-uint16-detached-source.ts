/*---
description: Suspension effects on a Uint16Array view: transfer detaches the original view while the guarded old index is retained.
features: [ts-proof-bounds, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-generators, ts-closures]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the suspension route.
// Transfer detaches the original view while the guarded old index is retained; node reads undefined after the change, otherwise 50003.
function read(change: number): { value: number | undefined; yielded: number | undefined; done: boolean } {
  const buffer = new ArrayBuffer(12, { maxByteLength: 20 });
  const view = new Uint16Array(buffer, 2, 3);
  const index = 2;
  view[index] = 50003;
  function* pause(): Generator<number, void, void> { yield 3; }
  function* steps(): Generator<number, number | undefined, void> {
    if (index < view.length) {
      yield* pause();
      return view[index];
    }
    return -999;
  }
  const iterator = steps();
  const first = iterator.next();
  if (change > 0) {
    buffer.transferToFixedLength(10);
  }
  const last = iterator.next();
  return { value: last.value, yielded: first.value, done: last.done === true };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? undefined : 50003);
  assert.sameValue(result.yielded, 3);
  assert.sameValue(result.done, true);
}
