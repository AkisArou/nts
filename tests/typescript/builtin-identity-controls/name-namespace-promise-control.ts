/*---
description: Control for name-namespace-promise; the target resolves to the real Promise builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-generics, ts-function-types, ts-instanceof, ts-namespace]
flags: [module]
---*/
// Control for ../builtin-identity/name-namespace-promise.ts: rename the shadow declaration.
export {};
let calls: number = 0;
let observed: number = 0;
namespace Local {
  class OwnPromise<T> {
    readonly values: T[] = [];
    constructor(executor: (resolve: (value: T) => void) => void) {
      calls++; executor(value => { this.values.push(value); });
    }
  }
  export function check(n: number): void {
    calls = 0;
    observed = 0;
    const result = new Promise<number>(resolve => { observed = n; resolve(n); });
    assert.sameValue(observed, n);
    assert.sameValue(result instanceof Promise, true);
    assert.sameValue(calls, 0);
  }
}
for (const n of [1, 3, 7]) Local.check(n);
