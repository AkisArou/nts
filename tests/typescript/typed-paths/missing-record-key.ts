/*---
description: Reading a missing key of a Record<string, number> gives undefined although the value type says number.
features: [ts-record, ts-null-undefined, ts-index-signatures]
---*/
const stock: Record<string, number> = { apples: 3 };
const pears = stock["pears"];
assert.sameValue(pears, undefined);
assert.sameValue(typeof pears, "undefined");
assert.sameValue(stock.apples + (stock.pears ?? 0), 3);
stock.pears = 0;
assert.sameValue(stock.pears ?? 9, 0);
