/*---
description: array-backing-assertion finding; the pair changes only the Claimed type alias.
features: [ts-type-aliases, ts-assertion-functions, ts-unknown]
---*/
type Claimed = number[];
function claim(value: unknown): asserts value is Claimed {}
const values: unknown = [2, "7"];
claim(values);
assert.sameValue(typeof values[1], "string");
assert.sameValue(String(values[1]), "7");
