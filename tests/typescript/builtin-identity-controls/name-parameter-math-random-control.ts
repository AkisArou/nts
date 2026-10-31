/*---
description: Control for name-parameter-math-random; the target resolves to the real Math builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-numbers]
flags: [module]
---*/
// Control for ../builtin-identity/name-parameter-math-random.ts: pass the real builtin.
export {};
let calls: number = 0;
let marker: number = 0;
const OwnMath: { random(): number } = {
  random(): number { calls++; return marker; }
};

function check(Math: { random(): number }, n: number): void {
  calls = 0;
  marker = n + 100;
  const result = Math.random();
  assert.sameValue(result >= 0 && result < 1, true);
  assert.sameValue(calls, 0);
}
for (const n of [1, 3, 7]) check(Math, n);
