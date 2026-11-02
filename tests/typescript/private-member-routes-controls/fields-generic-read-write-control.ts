/*---
description: A class-constrained generic parameter and return retain private payloads and the exact subclass receiver. The control uses checked per-name Maps.
features: [ts-private-member-routes, ts-private-member-route-fields, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unknown, ts-generics, ts-generic-constraints, ts-inheritance, ts-map-set]
---*/
// Vault instances cross a constrained update helper; node returns the original receiver and exposes its exact old and new private values. The control stores each private name in its own checked Map.
const valuesByOwner = new Map<object, unknown>();
class Vault {
  label: string = "same";
  constructor(value: unknown) { valuesByOwner.set(this, value); }
  read(): unknown { if (!valuesByOwner.has(this)) throw new TypeError(); return valuesByOwner.get(this); }
  write(value: unknown): unknown { if (!valuesByOwner.has(this)) throw new TypeError(); valuesByOwner.set(this, value); return value; }
  static owns(value: object): boolean { return valuesByOwner.has(value); }
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
