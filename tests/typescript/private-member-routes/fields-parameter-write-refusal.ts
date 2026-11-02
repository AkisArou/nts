/*---
description: A widened method interface sends valid and equal-shaped invalid receivers to private reads and writes.
features: [ts-private-member-routes, ts-private-member-route-fields, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unknown, ts-interfaces, ts-inheritance, ts-tuples, ts-unsound-bivariance, ts-private-fields]
---*/
// Owner receivers cross an object parameter through a method interface; node preserves valid writes and throws TypeError for unrelated and plain objects.
class Owner {
  label: string = "same"; #value: unknown;
  constructor(value: unknown) { this.#value = value; }
  static read(target: Owner): unknown { return target.#value; }
  static write(target: Owner, value: unknown): unknown { return target.#value = value; }
  static owns(target: object): boolean { return #value in target; }
}
class Other { label: string = "same"; #value: unknown; constructor(value: unknown) { this.#value = value; } read(): unknown { return this.#value; } }
class Child extends Owner {}
interface Operations { read(target: object): unknown; write(target: object, value: unknown): unknown; }
const operations: Operations = Owner;
function exercise(target: object, valid: boolean, value: unknown): void {
  const next = { value };
  assert.sameValue(Owner.owns(target), valid);
  if (valid) {
    assert.sameValue(operations.read(target), value); assert.sameValue(operations.write(target, next), next); assert.sameValue(operations.read(target), next);
  } else {
    assert.throws(TypeError, () => operations.read(target)); assert.throws(TypeError, () => operations.write(target, next));
    assert.sameValue(Owner.owns(target), false);
  }
}
const values: unknown[] = [undefined, null, false, -0, NaN, 0n, "", { value: 1 }, [1], () => 1];
for (const value of values) {
  const other = new Other(value), plain = { label: "same" };
  const entries: [object, boolean][] = [[new Owner(value), true], [other, false], [new Child(value), true], [plain, false]];
  for (const [target, valid] of entries) exercise(target, valid, value);
  assert.sameValue(other.read(), value); assert.sameValue(plain.label, "same");
}
