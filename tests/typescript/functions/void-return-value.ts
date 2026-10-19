/*---
description: A function typed as returning void may still return a value at run time, and the caller receives it.
features: [ts-functions, ts-void]
---*/
const results: number[] = [];
const push: (n: number) => void = (n) => results.push(n);
const returned: unknown = push(5);
assert.sameValue(returned, 1);
[1, 2].forEach((n) => results.push(n * 10));
assert.compareArray(results, [5, 10, 20]);
