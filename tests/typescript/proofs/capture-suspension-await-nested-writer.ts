/*---
description: An escaped reader sees a nested asynchronous writer after its await.
features: [ts-proof-capture, ts-route-suspension, ts-functions, ts-iteration, ts-closures, ts-async, ts-function-types, ts-objects]
flags: [async]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the writer assigns after suspension and after make returns; node updates the escaped reader.
function make(n: number) {
  let value = 0;
  const read = (): number => value;
  async function write(): Promise<void> {
    await Promise.resolve();
    value = n;
  }
  return { read, write };
}
async function main(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) {
    const pair = make(n);
    assert.sameValue(pair.read(), 0);
    await pair.write();
    assert.sameValue(pair.read(), n);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
