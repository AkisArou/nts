/*---
description: A queued microtask truncates the array before the resumed read.
features: [ts-proof-bounds, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-async, ts-closures, ts-null-undefined, ts-arrow-functions]
flags: [async]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before await lets the queued mutator run.
// A queued microtask truncates the array before the resumed read.
async function read(change: number): Promise<number | undefined> {
  const xs = [11, 22, 33, 44];
  const index = 3;
  if (index < xs.length) {
    const changed = Promise.resolve().then(() => { if (change > 0) xs.length = 3; });
    await changed;
    return xs[index];
  }
  return -1;
}
async function main(): Promise<void> {
  for (const change of [-1, 0, 1, 4]) assert.sameValue(await read(change), change > 0 ? undefined : 44);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
