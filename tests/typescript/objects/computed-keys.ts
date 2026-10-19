/*---
description: Computed keys in an object literal take their names from expressions, evaluated in order.
features: [ts-objects, ts-computed-keys]
---*/
const prefix = "item";
let index = 0;
const next = (): string => `${prefix}${++index}`;
const items = { [next()]: "a", [next()]: "b", [`${prefix}Count`]: 2 };
assert.sameValue(items.item1, "a");
assert.sameValue(items["item2"], "b");
assert.sameValue(Object.keys(items).join(","), "item1,item2,itemCount");
