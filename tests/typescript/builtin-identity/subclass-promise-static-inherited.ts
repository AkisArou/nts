/*---
description: A Promise subclass inherits resolve and receives subclass instances.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-static, ts-async, ts-instanceof, ts-functions]
flags: [async]
---*/
// Route: a typed Promise subclass inherits resolve; node creates an instance of that subclass.
class IdentityPromise extends Promise<number> {}
async function check(n: number): Promise<void> {
  const result: Promise<number> = IdentityPromise.resolve(n);
  assert.sameValue(result instanceof IdentityPromise, true);
  assert.sameValue(result instanceof Promise, true);
  assert.sameValue(Promise.resolve(n) instanceof IdentityPromise, false);
  assert.sameValue(await result, n);
}
async function main(): Promise<void> {
  for (const n of [-3, 0, 2.5, 7]) await check(n);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
