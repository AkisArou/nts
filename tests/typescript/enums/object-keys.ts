/*---
description: A numeric enum's object holds both directions, numbers first.
features: [ts-enum, ts-enum-reverse-mapping]
---*/
enum Size { Small, Large }
const keys: string[] = Object.keys(Size);
assert.sameValue(keys.length, 4);
assert.sameValue(keys[0], "0");
assert.sameValue(keys[1], "1");
assert.sameValue(keys[2], "Small");
assert.sameValue(keys[3], "Large");
