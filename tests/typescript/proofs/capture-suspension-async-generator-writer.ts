/*---
description: An async generator reader sees a caller write between its yielded steps.
features: [ts-proof-capture, ts-route-suspension, ts-functions, ts-iteration, ts-closures, ts-async, ts-async-generators, ts-objects]
flags: [async]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the caller writes while the async generator is suspended; node resumes its reader on that cell.
function make() {
  let value = 0;
  const read = (): number => value;
  async function* steps(): AsyncGenerator<number, number, void> {
    yield read();
    return read();
  }
  return { steps: steps(), write: (n: number): void => { value = n; } };
}
async function main(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) {
    const pair = make();
    assert.sameValue((await pair.steps.next()).value, 0);
    pair.write(n);
    const result = await pair.steps.next();
    assert.sameValue(result.done, true);
    assert.sameValue(result.value, n);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
