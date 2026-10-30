/*---
description: An awaited then throw preserves call-target effects in async generator yield.
features: [ts-proof-call-target, ts-route-exception, ts-functions, ts-arrow-functions, ts-closures, ts-arrays, ts-async, ts-errors, ts-iteration, ts-generators, ts-async-generators]
flags: [async]
---*/
// Fact: the initial function value has a known target (docs/foundations/objects.md, Calls).
// Route: the callback writes then throws; node catches at await and keeps the changed fact.
async function* observe(n: number): AsyncGenerator<number> {
  let target = (): number => 10;
  yield target();
  let caught = false;
  try {
    yield await Promise.resolve(n).then(delta => {
      if (delta > 0) {
        target = (): number => 20 + delta;
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
  yield target();
}
async function check(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) {
    const actual: number[] = [];
    for await (const value of observe(n)) actual.push(value);
    const final = n > 0 ? 20 + n : 10;
    const expected = n > 0 ? [10, final] : [10, 7, final];
    assert.sameValue(actual.length, expected.length);
    for (let i = 0; i < expected.length; i++) assert.sameValue(actual[i], expected[i]);
  }
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
