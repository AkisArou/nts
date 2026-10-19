/*---
description: An angle-bracket type assertion is erased like `as`, binding tighter than binary operators.
features: [ts-type-assertions]
---*/
const raw: unknown = 20;
const value = <number>raw + 1;
const text: unknown = "ab";
const size = (<string>text).length;
assert.sameValue(value, 21);
assert.sameValue(size, 2);
