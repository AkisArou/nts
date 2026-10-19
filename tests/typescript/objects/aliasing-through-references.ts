/*---
description: Two variables of an object type refer to one object; a change through one is seen through the other.
features: [ts-objects]
---*/
type Counter = { count: number };
const first: Counter = { count: 1 };
const second: Counter = first;
const holders: Counter[] = [first, second];
second.count = 5;
holders[0].count++;
assert.sameValue(first.count, 6);
assert.sameValue(holders[1] === first, true);
const copy: Counter = { ...first };
copy.count = 0;
assert.sameValue(first.count, 6);
