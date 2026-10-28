/*---
description: object-layout-assertion finding; the pair changes only the Claimed type alias.
features: [ts-type-aliases, ts-assertion-functions, ts-unknown]
---*/
type Claimed = number;
function claim(value: unknown): asserts value is { value: Claimed } {}
const cell: unknown = { value: "7" };
claim(cell);
function read(value: { value: Claimed }): Claimed { return value.value; }
const value = read(cell);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
