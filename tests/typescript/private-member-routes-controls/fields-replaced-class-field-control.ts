/*---
description: Replacing a class-typed field changes the private owner while saved aliases retain their independent payload. The control uses checked per-name Maps.
features: [ts-private-member-routes, ts-private-member-route-fields, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unknown, ts-map-set]
---*/
// Vault instances cross Holder.current; node follows the replaced receiver and preserves both old and new private values. The control stores each private name in its own checked Map.
const valuesByOwner = new Map<object, unknown>();
class Vault {
  label: string = "same";
  constructor(value: unknown) { valuesByOwner.set(this, value); }
  read(): unknown { if (!valuesByOwner.has(this)) throw new TypeError(); return valuesByOwner.get(this); }
  write(value: unknown): unknown { if (!valuesByOwner.has(this)) throw new TypeError(); valuesByOwner.set(this, value); return value; }
  static owns(value: object): boolean { return valuesByOwner.has(value); }
}
class Holder { current: Vault; constructor(current: Vault) { this.current = current; } }
const values: unknown[] = [undefined, null, false, -0, NaN, 0n, "", { value: 1 }, [1], () => 1];
for (const value of values) {
  const first = new Vault(value), second = new Vault(value), holder = new Holder(first), alias: Vault = holder.current;
  const next = { value }, last = { value };
  assert.sameValue(holder.current, first); assert.notSameValue(first, second);
  assert.sameValue(holder.current.read(), value); assert.sameValue(second.read(), value);
  assert.sameValue(Vault.owns(holder.current), true); assert.sameValue(Vault.owns({ label: "same" }), false);
  assert.sameValue(holder.current.write(next), next); assert.sameValue(alias.read(), next); assert.sameValue(second.read(), value);
  holder.current = second;
  assert.sameValue(holder.current, second); assert.sameValue(holder.current.read(), value);
  assert.sameValue(holder.current.write(last), last); assert.sameValue(second.read(), last); assert.sameValue(alias.read(), next);
  assert.sameValue(Vault.owns(alias), true); assert.sameValue(Vault.owns(holder.current), true);
}
