/*---
description: array-to-tuple-assertion finding; the pair changes only the Claimed type alias.
features: [ts-type-aliases, ts-assertion-functions, ts-unknown]
---*/
type Claimed = [number, boolean];
function claim(value: unknown): asserts value is Claimed {}
const values: unknown = ["7", true];
claim(values);
function describe(value: unknown): string { return typeof value + ":" + String(value); }
assert.sameValue(describe(values[0]), "string:7");
assert.sameValue(values[1], true);
