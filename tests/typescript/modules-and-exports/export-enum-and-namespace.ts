/*---
description: An exported enum and an exported namespace are created as in a script, as module bindings.
features: [ts-modules, ts-exports, ts-enum, ts-namespace]
flags: [module]
---*/
export enum Level { Low = 1, High = 3 }
export namespace Limits {
  export const max = Level.High * 10;
  export function within(n: number): boolean {
    return n <= max;
  }
}
assert.sameValue(Level[3], "High");
assert.sameValue(Limits.max, 30);
assert.sameValue(Limits.within(31), false);
