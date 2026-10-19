/*---
description: A double assertion changes only the static type; the value keeps its run-time type, so `+` concatenates a string asserted to be a number.
features: [ts-type-assertions, ts-unknown]
---*/
const text = "5";
const claimed = text as unknown as number;
const sum = claimed + 1;
assert.sameValue(sum as unknown, "51");
assert.sameValue(typeof claimed, "string");
const truthy = 0 as unknown as boolean;
assert.sameValue(truthy ? "yes" : "no", "no");
