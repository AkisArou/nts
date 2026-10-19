/*---
description: A string enum's members are their strings, with no reverse mapping.
features: [ts-enum, ts-enum-string]
---*/
enum Direction { Up = "UP", Down = "DOWN" }
assert.sameValue(Direction.Up, "UP");
assert.sameValue(Direction.Down, "DOWN");
const names: string[] = Object.keys(Direction);
assert.sameValue(names.length, 2);
assert.sameValue(names[0], "Up");
