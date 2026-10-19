/*---
description: A member initialised from a const variable takes the variable's value.
features: [ts-enum, ts-enum-computed]
---*/
const base = 10;
enum Offset { Start = base, Middle = base * 5 }
assert.sameValue(Offset.Start, 10);
assert.sameValue(Offset.Middle, 50);
assert.sameValue(Offset[50], "Middle");
