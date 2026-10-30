/*---
description: A binding write during delegated yield reaches the reader after delegation completes.
features: [ts-proof-capture, ts-route-suspension, ts-functions, ts-iteration, ts-closures, ts-generators, ts-objects]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the caller writes during yield delegation; node returns the latest shared binding.
function* pause(): Generator<number, void, void> { yield 0; }
function make() {
  let value = 0;
  const read = (): number => value;
  function* steps(): Generator<number, number, void> {
    yield* pause();
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
