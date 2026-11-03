/*---
description: One generic class parameter shares its runtime constructor across type arguments without absorbing a fitting unrelated class. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-classes, ts-class, ts-class-fields, ts-inheritance, ts-functions, ts-generics, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-structural-typing, ts-unknown, ts-narrowing, ts-object-type]
---*/
// Box<number> and Box<string> values cross the same generic inspect; node shares Box identity across type arguments and keeps Mimic separate. The control compares each prototype explicitly.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let cursor: unknown = Object.getPrototypeOf(value);
  while ((typeof cursor === "object" && cursor !== null) || typeof cursor === "function") {
    if (cursor === prototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}
class Box<T> { value: T; constructor(value: T) { this.value = value; } }
class Child<T> extends Box<T> {}
class Mimic<T> { value: T; constructor(value: T) { this.value = value; } }
function inspect<T>(value: Box<T>): boolean[] {
  return [follows(value, Box.prototype), follows(value, Child.prototype), follows(value, Mimic.prototype)];
}
const numbers: [Box<number>, boolean[]][] = [
  [new Box(-0), [true, false, false]], [new Child(NaN), [true, true, false]],
  [new Mimic(3), [false, false, true]], [{ value: 3 }, [false, false, false]],
];
const texts: [Box<string>, boolean[]][] = [
  [new Child(""), [true, true, false]], [new Mimic("same"), [false, false, true]],
  [new Box("same"), [true, false, false]], [{ value: "same" }, [false, false, false]],
];
for (const [value, expected] of numbers) { const actual = inspect(value); assert.compareArray(actual, expected); }
for (const [value, expected] of texts) { const actual = inspect(value); assert.compareArray(actual, expected); }
