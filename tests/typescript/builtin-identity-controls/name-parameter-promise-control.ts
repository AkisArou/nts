/*---
description: Control for name-parameter-promise; the target resolves to the real Promise builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-generics, ts-function-types, ts-instanceof, ts-construct-signatures]
flags: [module]
---*/
// Control for ../builtin-identity/name-parameter-promise.ts: pass the real builtin.
export {};
let calls: number = 0;
let observed: number = 0;
class OwnPromise<T> {
  readonly values: T[] = [];
  constructor(executor: (resolve: (value: T) => void) => void) {
    calls++; executor(value => { this.values.push(value); });
  }
}

function check(Promise: new (executor: (resolve: (value: number) => void) => void) => object, n: number): void {
  calls = 0;
  observed = 0;
  const result = new Promise(resolve => { observed = n; resolve(n); });
  assert.sameValue(observed, n);
  assert.sameValue(result instanceof Promise, true);
  assert.sameValue(calls, 0);
}
for (const n of [1, 3, 7]) check(Promise, n);
