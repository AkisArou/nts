/*---
description: A block-scoped Date namesake keeps its own constructor implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-numbers]
flags: [module]
---*/
// Route: block binding named Date; node runs the program's own implementation.
export {};
let calls: number = 0;
function check(n: number): void {
  {
    class Date {
      readonly stamp: number;
      constructor(stamp: number) { calls++; this.stamp = stamp + 100; }
      getTime(): number { return this.stamp; }
    }
    calls = 0;
    const result = new Date(n);
    assert.sameValue(result.getTime(), n + 100);
    assert.sameValue(calls, 1);
  }
}
for (const n of [1, 3, 7]) check(n);
