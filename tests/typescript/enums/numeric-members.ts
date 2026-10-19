/*---
description: Members of a numeric enum without initialisers count up from zero.
features: [ts-enum]
---*/
enum Color { Red, Green, Blue }
assert.sameValue(Color.Red, 0);
assert.sameValue(Color.Green, 1);
assert.sameValue(Color.Blue, 2);
