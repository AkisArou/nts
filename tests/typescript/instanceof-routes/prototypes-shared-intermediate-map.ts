/*---
description: Reparenting a shared intermediate prototype changes every descendant held in a Map.
features: [ts-instanceof-routes, ts-instanceof-route-prototypes, ts-class, ts-class-fields, ts-functions, ts-map-set, ts-object-type, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-instanceof]
---*/
// Two descendants and an alias cross Map values; node follows the shared bridge after each change while an unrelated entry stays ordinary.
class Left { marker: number = 1; }
class Right { marker: number = 1; }
const bridge: object = Object.create(Left.prototype);
const first: object = Object.create(bridge), second: object = Object.create(bridge), plain = {};
const values = new Map<string, object>([["first", first], ["second", second], ["alias", first], ["plain", plain]]);
function inspect(values: Map<string, object>): boolean[] {
  const actual: boolean[] = [];
  for (const value of values.values()) actual.push(value instanceof Left, value instanceof Right, value instanceof Object);
  return actual;
}
let previous = [true, false, true, true, false, true, true, false, true, false, false, true];
const changes: [object | null, boolean[]][] = [
  [Right.prototype, [false, true, true, false, true, true, false, true, true, false, false, true]],
  [null, [false, false, false, false, false, false, false, false, false, false, false, true]],
  [Left.prototype, [true, false, true, true, false, true, true, false, true, false, false, true]],
];
for (const [prototype, expected] of changes) {
  const before = inspect(values); assert.compareArray(before, previous);
  const changed = Object.setPrototypeOf(bridge, prototype);
  const after = inspect(values);
  assert.sameValue(changed, bridge); assert.sameValue(Object.getPrototypeOf(first), bridge); assert.sameValue(values.get("alias"), first); assert.compareArray(after, expected);
  previous = expected;
}
