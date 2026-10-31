/*---
description: A parameter-scoped Math namesake keeps its own min implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-numbers]
flags: [module]
---*/
// Route: typed parameter named Math; node runs the program's own implementation.
export {};
let calls: number = 0;
const pairs: [number, number][] = [[1, 4], [-3, 7], [8, 2]];
const OwnMath: { min(a: number, b: number): number } = {
  min(a: number, b: number): number { calls++; return a - b + 200; }
};

function check(Math: { min(a: number, b: number): number }, a: number, b: number): void {
  calls = 0;
  const result = Math.min(a, b);
  assert.sameValue(result, a - b + 200);
  assert.sameValue(calls, 1);
}
for (const [a, b] of pairs) check(OwnMath, a, b);
