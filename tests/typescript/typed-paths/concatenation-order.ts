/*---
description: `+` evaluates left to right, adding numbers until a string turns the rest into concatenation.
features: [ts-numbers, ts-conversions]
---*/
const one: number = 1;
const two: number = 2;
const three: string = "3";
assert.sameValue(one + two + three, "33");
assert.sameValue(three + one + two, "312");
assert.sameValue(three + (one + two), "33");
assert.sameValue(`${one + two}${three}`, "33");
