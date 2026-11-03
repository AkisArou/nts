/*---
description: Object.create results returned as object retain class ancestry without running a constructor. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-prototypes, ts-class, ts-class-fields, ts-inheritance, ts-functions, ts-object-type, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-unknown, ts-narrowing]
---*/
// Root, Child, Other and null prototypes pass through make; node follows the handmade chain and leaves the constructor count at zero. The control compares each prototype explicitly.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let cursor: unknown = Object.getPrototypeOf(value);
  while ((typeof cursor === "object" && cursor !== null) || typeof cursor === "function") {
    if (cursor === prototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}
let calls = 0;
class Root { value: number = 2; constructor() { calls++; } }
class Child extends Root {}
class Other { value: number = 2; constructor() { calls++; } }
function make(prototype: object | null): object { return Object.create(prototype); }
const bridge: object = Object.create(Root.prototype);
const rows: [object | null, boolean[]][] = [
  [Root.prototype, [true, false, false, true]], [Child.prototype, [true, true, false, true]],
  [Other.prototype, [false, false, true, true]], [bridge, [true, false, false, true]],
  [Object.prototype, [false, false, false, true]], [null, [false, false, false, false]],
];
for (const [prototype, expected] of rows) {
  const value: object = make(prototype);
  const actual = [follows(value, Root.prototype), follows(value, Child.prototype), follows(value, Other.prototype), follows(value, Object.prototype)];
  assert.sameValue(Object.getPrototypeOf(value), prototype); assert.compareArray(actual, expected); assert.sameValue(calls, 0);
}
