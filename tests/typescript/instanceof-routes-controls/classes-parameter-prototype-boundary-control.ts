/*---
description: A class-typed parameter distinguishes an instance from the prototype object itself along a deep chain. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-classes, ts-class, ts-class-fields, ts-inheritance, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-structural-typing, ts-unknown, ts-narrowing, ts-object-type]
---*/
// Root instances and class prototypes cross inspect; node excludes the value itself and finds only proper prototype ancestors. The control compares each prototype explicitly.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let cursor: unknown = Object.getPrototypeOf(value);
  while ((typeof cursor === "object" && cursor !== null) || typeof cursor === "function") {
    if (cursor === prototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}
class Root { value: number = 1; }
class Branch extends Root {}
class Leaf extends Branch {}
class Sibling extends Root {}
function inspect(value: Root): boolean[] {
  return [follows(value, Root.prototype), follows(value, Branch.prototype), follows(value, Leaf.prototype), follows(value, Sibling.prototype)];
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
