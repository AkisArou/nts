/*---
description: A microtask transfers the buffer before the resumed view read.
features: [ts-proof-bounds, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-async, ts-numbers, ts-null-undefined, ts-closures, ts-arrow-functions]
flags: [async]
---*/
// docs/foundations/objects.md, Arrays: index 0 is guarded before await lets a microtask detach the buffer.
// A microtask transfers the buffer before the resumed view read.
async function read(change: number): Promise<number | undefined> {
  const buffer = new ArrayBuffer(4);
  const view = new Int32Array(buffer);
  view[0] = 17;
  const index = 0;
  if (index < view.length) {
    const changed = Promise.resolve().then(() => { if (change > 0) buffer.transfer(); });
    await changed;
    return view[index];
  }
  return -1;
}
async function main(): Promise<void> {
  for (const change of [-1, 0, 1, 4]) assert.sameValue(await read(change), change > 0 ? undefined : 17);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
