/*---
description: A member named by a string literal is an ordinary key of the enum object.
features: [ts-enum, ts-enum-reverse-mapping]
---*/
enum Label { "two words" = 2, Plain }
assert.sameValue(Label["two words"], 2);
assert.sameValue(Label.Plain, 3);
assert.sameValue(Label[2], "two words");
