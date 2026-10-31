/*---
description: A Promise subclass inherits its constructor.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-async, ts-function-types, ts-arrow-functions]
flags: [async]
---*/
// Route: a typed Promise subclass inherits its constructor; node preserves the subclass and its behavior.
class IdentityPromise extends Promise<number> {}
async function check(n: number): Promise<void> {
  const result: Promise<number> = new IdentityPromise(resolve => resolve(n));
  assert.sameValue(result instanceof IdentityPromise, true);
  assert.sameValue(result instanceof Promise, true);
  assert.sameValue(new Promise<number>(resolve => resolve(n)) instanceof IdentityPromise, false);

  assert.sameValue(await result, n);
}
async function main(): Promise<void> {
  for (const n of [-3, 0, 2.5, 7]) await check(n);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
