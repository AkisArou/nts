/*---
description: A parameter-scoped Math namesake keeps its own random implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-numbers]
flags: [module]
---*/
// Route: typed parameter named Math; node runs the program's own implementation.
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
  assert.sameValue(result, n + 100);
  assert.sameValue(calls, 1);
}
for (const n of [1, 3, 7]) check(OwnMath, n);
