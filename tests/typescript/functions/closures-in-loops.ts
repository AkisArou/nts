/*---
description: A `let` loop variable is a new binding per iteration; a `var` one is shared by every closure.
features: [ts-functions, ts-closures]
---*/
const perIteration: (() => number)[] = [];
for (let i = 0; i < 3; i++) perIteration.push(() => i);
const shared: (() => number)[] = [];
for (var j = 0; j < 3; j++) shared.push(() => j);
assert.compareArray(perIteration.map((f) => f()), [0, 1, 2]);
assert.compareArray(shared.map((f) => f()), [3, 3, 3]);
