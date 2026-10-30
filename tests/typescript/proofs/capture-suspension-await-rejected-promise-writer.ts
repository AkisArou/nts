/*---
description: A captured write before rejection survives await and its catch.
features: [ts-proof-capture, ts-route-suspension, ts-functions, ts-iteration, ts-closures, ts-async, ts-errors]
flags: [async]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the awaited microtask writes then rejects; node keeps its write after catch.
async function afterAwait(n: number): Promise<number> {
  let value = 0;
  const read = (): number => value;
  const write = Promise.resolve().then(() => {
    value = n;
    throw new Error("after write");
  });
  try { await write; } catch {}
  return read();
}
async function main(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(await afterAwait(n), n);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
