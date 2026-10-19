/*---
description: A member initialised from another enum's member takes that member's value.
features: [ts-enum, ts-enum-computed]
---*/
enum Base { One = 1, Two = 2 }
enum Derived { Double = Base.Two * 2, Next }
assert.sameValue(Derived.Double, 4);
assert.sameValue(Derived.Next, 5);
assert.sameValue(Derived[4], "Double");
