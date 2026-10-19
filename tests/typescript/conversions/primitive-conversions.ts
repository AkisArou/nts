/*---
description: Number, String and Boolean convert typed primitives by the language's rules, edge cases included.
features: [ts-conversions, ts-null-undefined]
---*/
assert.sameValue(Number("12px"), Number.NaN);
assert.sameValue(parseInt("12px", 10), 12);
assert.sameValue(Number(""), 0);
assert.sameValue(Number(" 3 "), 3);
assert.sameValue(Number("0x10"), 16);
assert.sameValue(Number(null), 0);
assert.sameValue(Number(undefined), Number.NaN);
assert.sameValue(Number(true), 1);
assert.sameValue(String(null) + String(undefined), "nullundefined");
assert.sameValue(Boolean(""), false);
assert.sameValue(Boolean("0"), true);
assert.sameValue(Boolean(Number.NaN), false);
