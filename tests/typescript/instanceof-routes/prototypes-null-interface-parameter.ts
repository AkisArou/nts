/*---
description: A typed interface parameter preserves the absence of Object.prototype along null-rooted chains.
features: [ts-instanceof-routes, ts-instanceof-route-prototypes, ts-functions, ts-interfaces, ts-object-type, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-arrow-functions, ts-instanceof]
---*/
// Carrier holds ordinary, null-rooted and function values; node says false for Object.prototype itself and every chain that never reaches it.
interface Carrier { value: object; }
function inspect(carrier: Carrier): boolean[] {
  const value = carrier.value;
  return [value instanceof Object, value instanceof Function];
}
const root: object = Object.create(null), child: object = Object.create(root);
const rows: [object, boolean[]][] = [
  [root, [false, false]], [child, [false, false]], [Object.prototype, [false, false]],
  [{}, [true, false]], [[], [true, false]], [() => 0, [true, true]],
];
for (const [value, expected] of rows) {
  const carrier: Carrier = { value };
  const actual = inspect(carrier);
  assert.sameValue(carrier.value, value); assert.compareArray(actual, expected);
}
