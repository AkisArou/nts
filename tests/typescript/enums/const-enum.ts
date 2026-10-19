/*---
description: A const enum's members are their values at every use.
features: [ts-enum, ts-const-enum]
---*/
const enum Move { Up = 1, Down, Left, Right }
assert.sameValue(Move.Down, 2);
assert.sameValue(Move.Right, 4);
const total: number = Move.Up + Move.Left;
assert.sameValue(total, 4);
