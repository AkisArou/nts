/*---
description: Replacing a class-typed field changes the private owner while saved aliases retain their independent payload.
features: [ts-private-member-routes, ts-private-member-route-fields, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unknown, ts-private-fields]
---*/
// Vault instances cross Holder.current; node follows the replaced receiver and preserves both old and new private values.
class Vault {
  label: string = "same"; #value: unknown;
  constructor(value: unknown) { this.#value = value; }
  read(): unknown { return this.#value; }
  write(value: unknown): unknown { return this.#value = value; }
  static owns(value: object): boolean { return #value in value; }
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
