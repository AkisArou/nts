/*---
description: A typed interface parameter preserves the absence of Object.prototype along null-rooted chains. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-prototypes, ts-functions, ts-interfaces, ts-object-type, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-arrow-functions, ts-unknown, ts-narrowing]
---*/
// Carrier holds ordinary, null-rooted and function values; node says false for Object.prototype itself and every chain that never reaches it. The control compares each prototype explicitly.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let cursor: unknown = Object.getPrototypeOf(value);
  while ((typeof cursor === "object" && cursor !== null) || typeof cursor === "function") {
    if (cursor === prototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}
interface Carrier { value: object; }
function inspect(carrier: Carrier): boolean[] {
  const value = carrier.value;
  return [follows(value, Object.prototype), follows(value, Function.prototype)];
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
