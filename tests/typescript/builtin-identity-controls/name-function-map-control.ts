/*---
description: Control for name-function-map; the target resolves to the real Map builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-map-set]
flags: [module]
---*/
// Control for ../builtin-identity/name-function-map.ts: rename the shadow declaration.
export {};
let calls: number = 0;
function check(n: number): void {
  class OwnMap {
    readonly size: number;
    readonly saved: number;
    constructor(entries: [string, number][]) {
      calls++; this.saved = entries[0][1]; this.size = this.saved + 100;
    }
    get(key: string): number | undefined { return key === "item" ? this.saved + 200 : undefined; }
  }
  calls = 0;
  const result = new Map([["item", n]]);
  assert.sameValue(result.size, 1);
  assert.sameValue(result.get("item"), n);
  assert.sameValue(calls, 0);
}
for (const n of [1, 3, 7]) check(n);
