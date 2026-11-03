/*---
description: Reparenting a declared subclass prototype changes ancestry for both old and freshly constructed instances.
features: [ts-instanceof-routes, ts-instanceof-route-prototypes, ts-class, ts-class-fields, ts-inheritance, ts-functions, ts-object-type, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-instanceof]
---*/
// Root-typed old and fresh Derived instances cross inspect; node follows the current Derived.prototype chain even though construction still initializes Root fields.
class Root { marker: number = 7; }
class Derived extends Root {}
class Sibling extends Root {}
class Other { marker: number = 7; }
const old: Root = new Derived(), sibling: Root = new Sibling();
function inspect(value: Root): boolean[] {
  return [value instanceof Root, value instanceof Derived, value instanceof Sibling, value instanceof Other, value instanceof Object];
}
let previous = [true, true, false, false, true];
const changes: [object | null, boolean[]][] = [[Other.prototype, [false, true, false, true, true]], [null, [false, true, false, false, false]], [Root.prototype, [true, true, false, false, true]]];
for (const [prototype, expected] of changes) {
  const before = inspect(old); assert.compareArray(before, previous);
  const changed = Object.setPrototypeOf(Derived.prototype, prototype);
  assert.sameValue(changed, Derived.prototype);
  const rows: Root[] = [old, new Derived()];
  for (const value of rows) { const after = inspect(value); assert.sameValue(value.marker, 7); assert.compareArray(after, expected); }
  const untouched = inspect(sibling); assert.compareArray(untouched, [true, false, true, false, true]);
  previous = expected;
}
