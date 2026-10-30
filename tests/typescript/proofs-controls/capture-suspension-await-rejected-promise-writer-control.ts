/*---
description: Control for capture-suspension-await-rejected-promise-writer; the invalidating route is removed.
features: [ts-proof-capture, ts-route-suspension, ts-functions, ts-iteration, ts-closures, ts-async, ts-errors]
flags: [async]
---*/
// Paired subject: ../proofs/capture-suspension-await-rejected-promise-writer.ts.
// Only the invalidating route is removed; assertions observe the unchanged fact.
async function afterAwait(n: number): Promise<number> {
  let value = 0;
  const read = (): number => value;
  const write = Promise.resolve().then(() => {
    
    throw new Error("after write");
  });
  try { await write; } catch {}
  return read();
}
async function main(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(await afterAwait(n), 0);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
