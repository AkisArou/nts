/*---
description: Promise.all over a tuple of differently typed promises resolves to a tuple of their values, in order.
features: [ts-async, ts-tuples]
flags: [async]
---*/
async function count(): Promise<number> {
  return 3;
}
async function label(): Promise<string> {
  return "items";
}
async function main(): Promise<void> {
  const [n, text, flag] = await Promise.all([count(), label(), Promise.resolve(true)]);
  assert.sameValue(`${n} ${text}`, "3 items");
  assert.sameValue(flag, true);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
