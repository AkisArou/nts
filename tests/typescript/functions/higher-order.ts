/*---
description: Functions taking and returning typed functions compose behaviour at run time.
features: [ts-functions, ts-function-types]
---*/
type Transform = (n: number) => number;
function times(n: number): Transform {
  return (x) => x * n;
}
function pipe(...steps: Transform[]): Transform {
  return (x) => steps.reduce((acc, step) => step(acc), x);
}
const plusOne: Transform = (x) => x + 1;
const run = pipe(times(3), plusOne, times(2));
assert.sameValue(run(1), 8);
assert.sameValue(pipe()(5), 5);
