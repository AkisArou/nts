/*---
description: A numeric enum maps each value back to its member's name.
features: [ts-enum, ts-enum-reverse-mapping]
---*/
enum Color { Red, Green, Blue }
assert.sameValue(Color[Color.Green], "Green");
assert.sameValue(Color[2], "Blue");
