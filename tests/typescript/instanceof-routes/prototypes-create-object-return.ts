/*---
description: Object.create results returned as object retain class ancestry without running a constructor.
features: [ts-instanceof-routes, ts-instanceof-route-prototypes, ts-class, ts-class-fields, ts-inheritance, ts-functions, ts-object-type, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-instanceof]
---*/
// Root, Child, Other and null prototypes pass through make; node follows the handmade chain and leaves the constructor count at zero.
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
  const actual = [value instanceof Root, value instanceof Child, value instanceof Other, value instanceof Object];
  assert.sameValue(Object.getPrototypeOf(value), prototype); assert.compareArray(actual, expected); assert.sameValue(calls, 0);
}
