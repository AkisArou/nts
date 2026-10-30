/*---
description: An awaited then throw preserves length effects in async generator yield.
features: [ts-proof-length, ts-route-exception, ts-functions, ts-arrow-functions, ts-closures, ts-arrays, ts-async, ts-errors, ts-iteration, ts-generators, ts-async-generators]
flags: [async]
---*/
// Fact: the allocation proves an initial array length (docs/foundations/objects.md, Arrays).
// Route: the callback writes then throws; node catches at await and keeps the changed fact.
async function* observe(n: number): AsyncGenerator<number> {
  const xs: number[] = [];
  yield xs.length;
  let caught = false;
  try {
    yield await Promise.resolve(n).then(delta => {
      if (delta > 0) {
        xs.push(delta);
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
  yield xs.length;
}
async function check(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) {
    const actual: number[] = [];
    for await (const value of observe(n)) actual.push(value);
    const final = n > 0 ? 1 : 0;
    const expected = n > 0 ? [0, final] : [0, 7, final];
    assert.sameValue(actual.length, expected.length);
    for (let i = 0; i < expected.length; i++) assert.sameValue(actual[i], expected[i]);
  }
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
