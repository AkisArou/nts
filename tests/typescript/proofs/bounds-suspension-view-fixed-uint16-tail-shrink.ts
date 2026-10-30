/*---
description: Suspension effects on a Uint16Array view: shrinking to 9 bytes invalidates the whole fixed view although the indexed bytes survive.
features: [ts-proof-bounds, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-generators, ts-closures]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the suspension route.
// Shrinking to 9 bytes invalidates the whole fixed view although the indexed bytes survive; node reads undefined after the change, otherwise 50003.
function read(change: number): { value: number | undefined; yielded: number | undefined; done: boolean } {
  const buffer = new ArrayBuffer(16, { maxByteLength: 20 });
  const view = new Uint16Array(buffer, 4, 3);
  const index = 1;
  view[index] = 50003;
  function* steps(): Generator<number, number | undefined, void> {
    if (index < view.length) {
      yield 3;
      return view[index];
    }
    return -999;
  }
  const iterator = steps();
  const first = iterator.next();
  if (change > 0) {
    buffer.resize(9);
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
