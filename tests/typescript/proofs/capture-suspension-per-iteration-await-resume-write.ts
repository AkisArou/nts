/*---
description: An async loop writes each captured iteration binding after suspension.
features: [ts-proof-capture, ts-route-suspension, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-function-types, ts-arrays, ts-async]
flags: [async]
---*/
// Fact: an unwritten capture can be copied (docs/language/functions.md, Closures).
// Route: The resumed body writes its actual loop let; node retains each starting value plus delta after all awaits.
async function delayedReaders(delta: number): Promise<(() => number)[]> {
  const readers: (() => number)[] = [];
  for (let value of [10, 20, 30]) {
    readers.push(() => value);
    await Promise.resolve();
    value += delta;
  }
  return readers;
}
async function check(): Promise<void> {
  for (const delta of [-1, 0, 1, 3, 7]) {
    const readers = await delayedReaders(delta);
    assert.sameValue(readers.length, 3);
    assert.sameValue(readers[0](), 10 + delta);
    assert.sameValue(readers[1](), 20 + delta);
    assert.sameValue(readers[2](), 30 + delta);
  }
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
