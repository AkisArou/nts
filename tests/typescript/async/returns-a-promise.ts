/*---
description: An async function returns a promise of its typed result, which await unwraps.
features: [ts-async]
flags: [async]
---*/
async function total(values: number[]): Promise<number> {
  return values.reduce((a, b) => a + b, 0);
}
async function main(): Promise<void> {
  const pending = total([1, 2, 3]);
  assert.sameValue(pending instanceof Promise, true);
  const value: number = await pending;
  assert.sameValue(value, 6);
  assert.sameValue((await total([])) + 1, 1);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
