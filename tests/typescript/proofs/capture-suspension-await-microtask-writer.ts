/*---
description: A microtask writes the binding shared with a reader created before await.
features: [ts-proof-capture, ts-route-suspension, ts-functions, ts-iteration, ts-closures, ts-async]
flags: [async]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: await permits the queued writer to run; node resumes with the latest binding.
async function afterAwait(n: number): Promise<number> {
  let value = 0;
  const read = (): number => value;
  const write = Promise.resolve().then(() => { if (n > 0) value = n; });
  await write;
  return read();
}
async function main(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) {
    assert.sameValue(await afterAwait(n), n > 0 ? n : 0);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
