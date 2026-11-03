/*---
description: An abstract-class return retains concrete ancestor answers and refuses an equal-shaped unrelated value. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-classes, ts-class, ts-class-fields, ts-abstract, ts-inheritance, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-structural-typing, ts-unknown, ts-narrowing, ts-object-type]
---*/
// AbstractShape values return from carry; node preserves leaf and sibling chains without giving fitting literals an abstract ancestor. The control compares each prototype explicitly.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let cursor: unknown = Object.getPrototypeOf(value);
  while ((typeof cursor === "object" && cursor !== null) || typeof cursor === "function") {
    if (cursor === prototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}
abstract class AbstractShape { value: number = 2; }
class Branch extends AbstractShape {}
class Leaf extends Branch {}
class Sibling extends AbstractShape {}
class Unrelated { value: number = 2; }
function carry(value: AbstractShape): AbstractShape { return value; }
const rows: [AbstractShape, boolean[]][] = [
  [new Leaf(), [true, true, true, false]], [new Sibling(), [true, false, false, true]],
  [new Branch(), [true, true, false, false]], [new Unrelated(), [false, false, false, false]],
  [{ value: 2 }, [false, false, false, false]], [new Leaf(), [true, true, true, false]],
];
for (const [value, expected] of rows) {
  const returned: AbstractShape = carry(value);
  const actual = [follows(returned, AbstractShape.prototype), follows(returned, Branch.prototype), follows(returned, Leaf.prototype), follows(returned, Sibling.prototype)];
  assert.sameValue(returned, value); assert.sameValue(returned.value, 2); assert.compareArray(actual, expected);
}
