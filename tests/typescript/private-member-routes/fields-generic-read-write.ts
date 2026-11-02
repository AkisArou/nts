/*---
description: A class-constrained generic parameter and return retain private payloads and the exact subclass receiver.
features: [ts-private-member-routes, ts-private-member-route-fields, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unknown, ts-generics, ts-generic-constraints, ts-inheritance, ts-private-fields]
---*/
// Vault instances cross a constrained update helper; node returns the original receiver and exposes its exact old and new private values.
class Vault {
  label: string = "same"; #value: unknown;
  constructor(value: unknown) { this.#value = value; }
  read(): unknown { return this.#value; }
  write(value: unknown): unknown { return this.#value = value; }
  static owns(value: object): boolean { return #value in value; }
}
class Child extends Vault { extra: number = 7; }
function update<T extends Vault>(owner: T, expected: unknown, next: unknown): T {
  assert.sameValue(owner.read(), expected); assert.sameValue(owner.write(next), next); assert.sameValue(owner.read(), next);
  return owner;
}
const values: unknown[] = [undefined, null, false, -0, NaN, 0n, "", { value: 1 }, [1], () => 1];
for (const value of values) {
  const base = new Vault(value), child = new Child(value), replacement = { value };
  const entries: Vault[] = [child, base];
  for (const entry of entries) {
    const result = update(entry, value, replacement);
    assert.sameValue(result, entry); assert.sameValue(Vault.owns(result), true); assert.sameValue(entry.read(), replacement);
  }
  const result: Child = update(child, replacement, value);
  assert.sameValue(result, child); assert.sameValue(result.extra, 7); assert.sameValue(child.read(), value); assert.sameValue(base.read(), replacement);
}
