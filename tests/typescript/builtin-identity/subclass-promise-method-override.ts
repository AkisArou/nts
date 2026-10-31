/*---
description: A Promise subclass dispatches an override through a base-typed value.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-override, ts-async, ts-function-types, ts-arrow-functions]
flags: [async]
---*/
// Route: a typed Promise subclass dispatches an override through a base-typed value; node preserves the subclass and its behavior.
class IdentityPromise extends Promise<number> {
  override finally(onfinally?: (() => void) | null): Promise<number> {
    return super.finally(onfinally).then(value => value + 100);
  }
}
async function check(n: number): Promise<void> {
  const result: Promise<number> = new IdentityPromise(resolve => resolve(n));
  assert.sameValue(result instanceof IdentityPromise, true);
  assert.sameValue(result instanceof Promise, true);
  assert.sameValue(new Promise<number>(resolve => resolve(n)) instanceof IdentityPromise, false);
  let callbacks = 0;
  const changed = result.finally(() => { callbacks++; });
  assert.sameValue(await changed, n + 100);
  assert.sameValue(callbacks, 1);
  assert.sameValue(changed instanceof IdentityPromise, true);
}
async function main(): Promise<void> {
  for (const n of [-3, 0, 2.5, 7]) await check(n);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
