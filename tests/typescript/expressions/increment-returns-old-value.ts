/*---
description: Postfix increment on a typed field yields the old value; prefix yields the new one.
features: [ts-expressions]
---*/
const counter = { n: 1 };
const before = counter.n++;
const after = ++counter.n;
const items = [10];
const old = items[0]--;
assert.sameValue(before, 1);
assert.sameValue(after, 3);
assert.sameValue(old, 10);
assert.sameValue(items[0], 9);
