/*---
description: Control for subclass-promise-static-inherited; call Promise.resolve directly; adjust the subclass observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-static, ts-async, ts-instanceof, ts-functions]
flags: [async]
---*/
// Paired case: ../builtin-identity/subclass-promise-static-inherited.ts.
// Change: Call Promise.resolve directly; adjust the subclass observations.
class IdentityPromise extends Promise<number> {}
async function check(n: number): Promise<void> {
  const result: Promise<number> = Promise.resolve(n);
  assert.sameValue(result instanceof IdentityPromise, false);
  assert.sameValue(result instanceof Promise, true);
  assert.sameValue(Promise.resolve(n) instanceof IdentityPromise, false);
  assert.sameValue(await result, n);
}
async function main(): Promise<void> {
  for (const n of [-3, 0, 2.5, 7]) await check(n);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
