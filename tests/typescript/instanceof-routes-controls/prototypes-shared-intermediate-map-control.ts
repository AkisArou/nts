/*---
description: Reparenting a shared intermediate prototype changes every descendant held in a Map. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-prototypes, ts-class, ts-class-fields, ts-functions, ts-map-set, ts-object-type, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-unknown, ts-narrowing]
---*/
// Two descendants and an alias cross Map values; node follows the shared bridge after each change while an unrelated entry stays ordinary. The control compares each prototype explicitly.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let cursor: unknown = Object.getPrototypeOf(value);
  while ((typeof cursor === "object" && cursor !== null) || typeof cursor === "function") {
    if (cursor === prototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}
class Left { marker: number = 1; }
class Right { marker: number = 1; }
const bridge: object = Object.create(Left.prototype);
const first: object = Object.create(bridge), second: object = Object.create(bridge), plain = {};
const values = new Map<string, object>([["first", first], ["second", second], ["alias", first], ["plain", plain]]);
function inspect(values: Map<string, object>): boolean[] {
  const actual: boolean[] = [];
  for (const value of values.values()) actual.push(follows(value, Left.prototype), follows(value, Right.prototype), follows(value, Object.prototype));
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
