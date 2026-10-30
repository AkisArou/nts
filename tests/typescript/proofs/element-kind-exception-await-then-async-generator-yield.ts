/*---
description: An awaited then throw preserves element-kind effects in async generator yield.
features: [ts-proof-element-kind, ts-route-exception, ts-functions, ts-arrow-functions, ts-closures, ts-arrays, ts-async, ts-errors, ts-iteration, ts-numbers, ts-generators, ts-async-generators]
flags: [async]
---*/
// Fact: the allocation initially contains only small integers (docs/foundations/objects.md, Arrays).
// Route: the callback writes then throws; node catches at await and keeps the changed fact.
async function* observe(n: number): AsyncGenerator<number> {
  const xs = [4, 8, 12];
  yield xs[1];
  let caught = false;
  try {
    yield await Promise.resolve(n).then(delta => {
      if (delta > 0) {
        xs[1] = 2147483648 + delta;
        throw new Error("callback write");
      }
      return 7;
    });
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    assert.sameValue(error.message, "callback write");
    caught = true;
  }
  assert.sameValue(caught, n > 0);
  yield xs[1];
}
async function check(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) {
    const actual: number[] = [];
    for await (const value of observe(n)) actual.push(value);
    assert.sameValue(actual.length, n > 0 ? 2 : 3);
    assert.sameValue(actual[0], 8);
    if (n <= 0) assert.sameValue(actual[1], 7);
    assert.sameValue(actual[actual.length - 1], n > 0 ? 2147483648 + n : 8);
  }
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
