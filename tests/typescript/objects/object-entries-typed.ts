/*---
description: Object.entries and Object.fromEntries move a typed object through key-value pairs.
features: [ts-objects, ts-tuples, ts-record]
---*/
const prices = { apple: 2, pear: 3, plum: 1 };
const doubled = Object.fromEntries(Object.entries(prices).map(([fruit, price]) => [fruit, price * 2]));
assert.sameValue(doubled.pear, 6);
assert.sameValue(Object.keys(doubled).join(","), "apple,pear,plum");
const cheapest = Object.entries(prices).reduce((best, entry) => (entry[1] < best[1] ? entry : best));
assert.sameValue(cheapest[0], "plum");
