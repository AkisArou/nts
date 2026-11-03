/*---
description: Changing an object through a class-typed field immediately changes every ancestor answer.
features: [ts-instanceof-routes, ts-instanceof-route-prototypes, ts-class, ts-class-fields, ts-inheritance, ts-functions, ts-object-type, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-structural-typing, ts-instanceof]
---*/
// Holder.current retains an alias while its prototype changes; node follows Right, null, Child and Root in turn without changing the own marker.
class Root { marker: number = 1; }
class Child extends Root {}
class Right { marker: number = 1; }
class Holder { current: Root; constructor(current: Root) { this.current = current; } }
function inspect(holder: Holder): boolean[] {
  return [holder.current instanceof Root, holder.current instanceof Child, holder.current instanceof Right, holder.current instanceof Object];
}
const rows: [Root, boolean[]][] = [[new Root(), [true, false, false, true]], [new Child(), [true, true, false, true]], [new Right(), [false, false, true, true]], [{ marker: 1 }, [false, false, false, true]]];
const changes: [object | null, boolean[]][] = [[Right.prototype, [false, false, true, true]], [null, [false, false, false, false]], [Child.prototype, [true, true, false, true]], [Root.prototype, [true, false, false, true]]];
for (const [value, initial] of rows) {
  const holder = new Holder(value);
  let previous = initial;
  for (const [prototype, expected] of changes) {
    const before = inspect(holder); assert.compareArray(before, previous);
    const changed = Object.setPrototypeOf(holder.current, prototype);
    const after = inspect(holder);
    assert.sameValue(changed, value); assert.sameValue(holder.current, value); assert.sameValue(holder.current.marker, 1); assert.compareArray(after, expected);
    previous = expected;
  }
}
