/*---
description: Control for subclass-promise-super-arguments; construct Promise directly; adjust the subclass observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-async, ts-function-types, ts-arrow-functions]
flags: [async]
---*/
// Paired case: ../builtin-identity/subclass-promise-super-arguments.ts.
// Change: Construct Promise directly; adjust the subclass observations.
let constructions = 0;
class IdentityPromise extends Promise<number> {
  constructor(executor: (resolve: (value: number | PromiseLike<number>) => void,
    reject: (reason?: unknown) => void) => void) {
    super(executor);
    constructions++;
  }
}
async function check(n: number): Promise<void> {
  const before = constructions;
  const result: Promise<number> = new Promise<number>(resolve => resolve(n));
  assert.sameValue(constructions - before, 0);
  assert.sameValue(result instanceof IdentityPromise, false);
  assert.sameValue(result instanceof Promise, true);
  assert.sameValue(new Promise<number>(resolve => resolve(n)) instanceof IdentityPromise, false);

  assert.sameValue(await result, n);
}
async function main(): Promise<void> {
  for (const n of [-3, 0, 2.5, 7]) await check(n);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
