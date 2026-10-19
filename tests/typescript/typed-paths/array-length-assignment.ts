/*---
description: Assigning a typed array's length truncates or extends it.
features: [ts-arrays]
---*/
const items: string[] = ["a", "b", "c", "d"];
items.length = 2;
assert.compareArray(items, ["a", "b"]);
items.length = 4;
assert.sameValue(items[3], undefined);
assert.sameValue(items.length, 4);
items[9] = "j";
assert.sameValue(items.length, 10);
