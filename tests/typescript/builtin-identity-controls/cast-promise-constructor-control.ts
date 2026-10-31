/*---
description: Control for cast-promise-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-async, ts-function-types, ts-arrow-functions, ts-instanceof]
flags: [async]
---*/
// Paired case: ../builtin-identity/cast-promise-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
let calls = 0;
class OwnPromise {
  value: number = 0;
  constructor(executor: (resolve: (value: number) => void) => void) {
    calls++;
    executor((value: number): void => { this.value = value + 100; });
  }
  then(resolve: (value: number) => void): void { resolve(this.value); }
}
async function check(n: number): Promise<void> {
  calls = 0;
  const Target = Promise;
  const value = new Target<number>(resolve => resolve(n));
  assert.sameValue(calls, 0);
  assert.sameValue(value instanceof OwnPromise, false);
  assert.sameValue(value instanceof Promise, true);
  assert.sameValue(await value, n);
}
async function run(): Promise<void> {
  for (const n of [-3, 0, 1, 7]) await check(n);
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
