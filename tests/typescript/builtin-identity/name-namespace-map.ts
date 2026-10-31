/*---
description: A namespace-scoped Map namesake keeps its own constructor implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-map-set, ts-namespace]
flags: [module]
---*/
// Route: namespace binding named Map; node runs the program's own implementation.
export {};
let calls: number = 0;
namespace Local {
  class Map {
    readonly size: number;
    readonly saved: number;
    constructor(entries: [string, number][]) {
      calls++; this.saved = entries[0][1]; this.size = this.saved + 100;
    }
    get(key: string): number | undefined { return key === "item" ? this.saved + 200 : undefined; }
  }
  export function check(n: number): void {
    calls = 0;
    const result = new Map([["item", n]]);
    assert.sameValue(result.size, n + 100);
    assert.sameValue(result.get("item"), n + 200);
    assert.sameValue(calls, 1);
  }
}
for (const n of [1, 3, 7]) Local.check(n);
