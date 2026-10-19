/*---
description: A const object and the union of its values stand in for a string enum.
features: [ts-literal-types, ts-as-const, ts-keyof, ts-typeof-type, ts-indexed-access]
---*/
const Direction = { Up: "UP", Down: "DOWN", Left: "LEFT" } as const;
type Direction = (typeof Direction)[keyof typeof Direction];
function reverse(direction: Direction): Direction {
  if (direction === Direction.Up) return Direction.Down;
  if (direction === Direction.Down) return Direction.Up;
  return direction;
}
assert.sameValue(reverse(Direction.Up), "DOWN");
assert.sameValue(reverse("LEFT"), "LEFT");
assert.sameValue(Object.values(Direction).join(","), "UP,DOWN,LEFT");
