/*---
description: Control for subclass-promise-method-override; construct Promise directly; adjust the subclass observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-override, ts-async, ts-function-types, ts-arrow-functions]
flags: [async]
---*/
// Paired case: ../builtin-identity/subclass-promise-method-override.ts.
// Change: Construct Promise directly; adjust the subclass observations.
class IdentityPromise extends Promise<number> {
  override finally(onfinally?: (() => void) | null): Promise<number> {
    return super.finally(onfinally).then(value => value + 100);
  }
}
async function check(n: number): Promise<void> {
  const result: Promise<number> = new Promise<number>(resolve => resolve(n));
  assert.sameValue(result instanceof IdentityPromise, false);
  assert.sameValue(result instanceof Promise, true);
  assert.sameValue(new Promise<number>(resolve => resolve(n)) instanceof IdentityPromise, false);
  let callbacks = 0;
  const changed = result.finally(() => { callbacks++; });
  assert.sameValue(await changed, n);
  assert.sameValue(callbacks, 1);
  assert.sameValue(changed instanceof IdentityPromise, false);
}
async function main(): Promise<void> {
  for (const n of [-3, 0, 2.5, 7]) await check(n);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
