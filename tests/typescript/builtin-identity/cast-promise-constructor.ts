/*---
description: An own thenable class cast to PromiseConstructor still executes its own constructor.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-async, ts-function-types, ts-arrow-functions, ts-instanceof]
flags: [async]
---*/
// Route: a class is asserted to be Promise; node awaits the own thenable result.
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
  const Target = OwnPromise as unknown as typeof Promise;
  const value = new Target<number>(resolve => resolve(n));
  assert.sameValue(calls, 1);
  assert.sameValue(value instanceof OwnPromise, true);
  assert.sameValue(value instanceof Promise, false);
  assert.sameValue(await value, n + 100);
}
async function run(): Promise<void> {
  for (const n of [-3, 0, 1, 7]) await check(n);
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
