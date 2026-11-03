/*---
description: A public constructor property in an interface array cannot replace the actual prototype chain. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-classes, ts-class, ts-class-fields, ts-inheritance, ts-functions, ts-interfaces, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-structural-typing, ts-unknown, ts-narrowing, ts-object-type]
---*/
// Root, Child and Other cross View elements with spoofed constructor fields; node answers by ancestry regardless of the visible constructor value. The control compares each prototype explicitly.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let cursor: unknown = Object.getPrototypeOf(value);
  while ((typeof cursor === "object" && cursor !== null) || typeof cursor === "function") {
    if (cursor === prototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}
class Root { value: number = 9; }
class Child extends Root {}
class Other { value: number = 9; }
interface View { value: number; constructor: Function; }
const rows: [View, Function, boolean[]][] = [
  [Object.assign(new Root(), { constructor: Other }), Other, [true, false, false]],
  [Object.assign(new Child(), { constructor: Other }), Other, [true, true, false]],
  [new Other(), Other, [false, false, true]],
  [{ value: 9, constructor: Other }, Other, [false, false, false]],
  [{ value: 9, constructor: Root }, Root, [false, false, false]],
  [Object.assign(new Child(), { constructor: Root }), Root, [true, true, false]],
];
for (const [value, visible, expected] of rows) {
  const actual = [follows(value, Root.prototype), follows(value, Child.prototype), follows(value, Other.prototype)];
  assert.sameValue(value.constructor, visible); assert.compareArray(actual, expected);
}
