/*---
description: An initialiser may name an earlier member of its own enum without qualifying it.
features: [ts-enum, ts-enum-computed]
---*/
enum Size { Unit = 3, Pair = Unit * 2, Square = Unit * Unit }
assert.sameValue(Size.Pair, 6);
assert.sameValue(Size.Square, 9);
