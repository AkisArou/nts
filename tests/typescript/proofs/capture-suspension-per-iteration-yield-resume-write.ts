/*---
description: Resuming a generator writes the same iteration binding captured before yield.
features: [ts-proof-capture, ts-route-suspension, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-function-types, ts-arrays, ts-generators, ts-errors]
---*/
// Fact: an unwritten capture can be copied (docs/language/functions.md, Closures).
// Route: The resumed body writes its actual loop let; node retains each starting value plus the caller delta after all yields.
function* delayedReaders(): Generator<() => number, (() => number)[], number> {
  const readers: (() => number)[] = [];
  for (let value of [10, 20, 30]) {
    const read = (): number => value;
    readers.push(read);
    const delta = yield read;
    value += delta;
  }
  return readers;
}
for (const delta of [-1, 0, 1, 3, 7]) {
  const steps = delayedReaders();
  let step = steps.next();
  for (const start of [10, 20, 30]) {
    if (step.done) throw new Error("expected an iteration reader");
    assert.sameValue(step.value(), start);
    step = steps.next(delta);
  }
  if (!step.done) throw new Error("expected saved readers");
  const readers = step.value;
  assert.sameValue(readers.length, 3);
  assert.sameValue(readers[0](), 10 + delta);
  assert.sameValue(readers[1](), 20 + delta);
  assert.sameValue(readers[2](), 30 + delta);
}
