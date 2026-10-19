/*---
description: The `in` operator narrows a union of object types by a property only one of them has.
features: [ts-unions, ts-narrowing]
---*/
type Fish = { swim: () => string };
type Bird = { fly: () => string };
function move(animal: Fish | Bird): string {
  if ("swim" in animal) return animal.swim();
  return animal.fly();
}
assert.sameValue(move({ swim: () => "splash" }), "splash");
assert.sameValue(move({ fly: () => "flap" }), "flap");
