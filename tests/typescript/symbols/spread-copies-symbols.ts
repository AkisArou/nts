/*---
description: Object spread and Object.assign copy own enumerable symbol-keyed properties.
features: [ts-symbols, ts-spread]
---*/
const secret = Symbol("secret");
const original = { [secret]: "s", open: "o" };
const spread = { ...original };
const assigned = Object.assign({}, original);
assert.sameValue(spread[secret], "s");
assert.sameValue(assigned[secret], "s");
assert.sameValue(Object.getOwnPropertySymbols(spread).length, 1);
