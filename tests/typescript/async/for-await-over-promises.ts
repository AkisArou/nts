/*---
description: for-await over an array of promises and plain values awaits each element in order.
features: [ts-async, ts-async-generators]
flags: [async]
---*/
async function main(): Promise<void> {
  const deferred = (value: string): Promise<string> => Promise.resolve().then(() => value);
  const seen: string[] = [];
  for await (const value of [deferred("a"), Promise.resolve("b"), "c"]) seen.push(value);
  assert.compareArray(seen, ["a", "b", "c"]);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
