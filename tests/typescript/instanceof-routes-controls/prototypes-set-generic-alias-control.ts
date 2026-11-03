/*---
description: A generic object mutation returns the same alias while class, array and function ancestry follows the replacement chain. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-prototypes, ts-class, ts-class-fields, ts-functions, ts-generics, ts-generic-constraints, ts-object-type, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-arrow-functions, ts-unknown, ts-narrowing]
---*/
// Object-constrained change returns instances, arrays and functions; node changes their ancestor answers and restores each original chain through the retained alias. The control compares each prototype explicitly.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let cursor: unknown = Object.getPrototypeOf(value);
  while ((typeof cursor === "object" && cursor !== null) || typeof cursor === "function") {
    if (cursor === prototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}
class Left { label: string = "same"; }
class Right { label: string = "same"; }
function change<T extends object>(value: T, prototype: object | null): T { return Object.setPrototypeOf(value, prototype); }
function inspect(value: object): boolean[] {
  return [follows(value, Left.prototype), follows(value, Right.prototype), follows(value, Object.prototype), follows(value, Function.prototype), follows(value, Array.prototype)];
}
const rows: [object, boolean[]][] = [[new Left(), [true, false, true, false, false]], [new Right(), [false, true, true, false, false]], [{}, [false, false, true, false, false]], [[], [false, false, true, false, true]], [() => 0, [false, false, true, true, false]]];
for (const [value, initial] of rows) {
  const alias = value, original: object | null = Object.getPrototypeOf(value);
  const changes: [object | null, boolean[]][] = [[Right.prototype, [false, true, true, false, false]], [null, [false, false, false, false, false]], [Left.prototype, [true, false, true, false, false]], [original, initial]];
  let previous = initial;
  for (const [prototype, expected] of changes) {
    const before = inspect(alias); assert.compareArray(before, previous);
    const returned = change(value, prototype);
    const after = inspect(returned);
    assert.sameValue(returned, alias); assert.sameValue(Object.getPrototypeOf(alias), prototype); assert.compareArray(after, expected);
    previous = expected;
  }
}
