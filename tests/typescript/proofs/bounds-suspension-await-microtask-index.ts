/*---
description: A queued microtask changes index 0 to 4 before charCodeAt.
features: [ts-proof-bounds, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-async, ts-closures, ts-strings, ts-numbers, ts-arrow-functions]
flags: [async]
---*/
// docs/foundations/objects.md, Arrays: captured index 0 starts below string length 4 before await.
// A queued microtask changes index 0 to 4 before charCodeAt.
async function read(change: number): Promise<number> {
  const text = "abcd";
  let index = 0;
  const changed = Promise.resolve().then(() => { if (change > 0) index = 4; });
  await changed;
  return text.charCodeAt(index);
}
async function main(): Promise<void> {
  for (const change of [-1, 0, 1, 4]) assert.sameValue(await read(change), change > 0 ? NaN : 97);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
