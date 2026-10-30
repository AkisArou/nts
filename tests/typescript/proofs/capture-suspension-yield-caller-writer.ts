/*---
description: A reader resumed after yield sees the binding written by the generator caller.
features: [ts-proof-capture, ts-route-suspension, ts-functions, ts-iteration, ts-closures, ts-generators, ts-objects]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the caller writes between next calls; node shares the binding with the resumed reader.
function make() {
  let value = 0;
  const read = (): number => value;
  function* steps(): Generator<number, number, void> {
    yield read();
    return read();
  }
  return { steps: steps(), write: (n: number): void => { value = n; } };
}
for (const n of [-1, 0, 1, 3, 7]) {
  const pair = make();
  assert.sameValue(pair.steps.next().value, 0);
  pair.write(n);
  const result = pair.steps.next();
  assert.sameValue(result.done, true);
  assert.sameValue(result.value, n);
}
