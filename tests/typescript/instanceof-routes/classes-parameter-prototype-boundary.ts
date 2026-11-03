/*---
description: A class-typed parameter distinguishes an instance from the prototype object itself along a deep chain.
features: [ts-instanceof-routes, ts-instanceof-route-classes, ts-class, ts-class-fields, ts-inheritance, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-structural-typing, ts-instanceof]
---*/
// Root instances and class prototypes cross inspect; node excludes the value itself and finds only proper prototype ancestors.
class Root { value: number = 1; }
class Branch extends Root {}
class Leaf extends Branch {}
class Sibling extends Root {}
function inspect(value: Root): boolean[] {
  return [value instanceof Root, value instanceof Branch, value instanceof Leaf, value instanceof Sibling];
}
const rows: [Root, boolean[]][] = [
  [new Sibling(), [true, false, false, true]], [new Leaf(), [true, true, true, false]],
  [new Root(), [true, false, false, false]], [new Branch(), [true, true, false, false]],
  [Root.prototype, [false, false, false, false]], [Branch.prototype, [true, false, false, false]],
  [Leaf.prototype, [true, true, false, false]], [Sibling.prototype, [true, false, false, false]],
  [{ value: 1 }, [false, false, false, false]],
];
for (const [value, expected] of rows) {
  const actual = inspect(value);
  assert.compareArray(actual, expected);
}
