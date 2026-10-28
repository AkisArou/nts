/*---
description: array-to-tuple-assertion control; the pair changes only the Claimed type alias.
features: [ts-type-aliases, ts-assertion-functions, ts-unknown]
---*/
type Claimed = unknown[];
function claim(value: unknown): asserts value is Claimed {}
const values: unknown = ["7", true];
claim(values);
function describe(value: unknown): string { return typeof value + ":" + String(value); }
assert.sameValue(describe(values[0]), "string:7");
assert.sameValue(values[1], true);
