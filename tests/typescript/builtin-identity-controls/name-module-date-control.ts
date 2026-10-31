/*---
description: Control for name-module-date; the target resolves to the real Date builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-numbers]
flags: [module]
---*/
// Control for ../builtin-identity/name-module-date.ts: rename the shadow declaration.
export {};
let calls: number = 0;
class OwnDate {
  readonly stamp: number;
  constructor(stamp: number) { calls++; this.stamp = stamp + 100; }
  getTime(): number { return this.stamp; }
}

function check(n: number): void {
  calls = 0;
  const result = new Date(n);
  assert.sameValue(result.getTime(), n);
  assert.sameValue(calls, 0);
}
for (const n of [1, 3, 7]) check(n);
