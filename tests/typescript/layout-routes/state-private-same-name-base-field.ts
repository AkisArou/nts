/*---
description: "Base and derived private slots with the same spelling remain independent through a base-typed field."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-private-fields, ts-instanceof, ts-narrowing]
---*/
// SecretBase, SecretChild and SecretLeaf carry distinct public fields and independent #x slots; a base-typed holder preserves both private states across writes.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
class SecretBase {
  kind: string = "base"; head: number = -0; #x: unknown;
  constructor(value: unknown) { this.#x = value; }
  readBase(): unknown { return this.#x; } writeBase(value: unknown): void { this.#x = value; }
}
class SecretChild extends SecretBase {
  override kind: string = "child"; tail: string = ""; #x: unknown;
  constructor(base: unknown, child: unknown) { super(base); this.#x = child; }
  readChild(): unknown { return this.#x; } writeChild(value: unknown): void { this.#x = value; }
}
class SecretLeaf extends SecretChild { override kind: string = "leaf"; token: bigint = 0n; }
for (let index = 0; index < values.length; index++) {
  const value = values[index], next = values[(index + 1) % values.length], replacement = values[(index + 2) % values.length];
  const entries: { source: SecretBase; kind: string }[] = [{ source: new SecretBase(value), kind: "base" }, { source: new SecretChild(value, next), kind: "child" }, { source: new SecretLeaf(value, next), kind: "leaf" }];
  for (const entry of entries) {
    const source = entry.source, holder: { item: SecretBase } = { item: source };
    same(holder.item, source); same(holder.item.kind, entry.kind); same(holder.item.head, -0); same(holder.item.readBase(), value);
    same(holder.item instanceof SecretBase, true); same(holder.item instanceof SecretChild, entry.kind !== "base"); same(holder.item instanceof SecretLeaf, entry.kind === "leaf");
    if (source instanceof SecretChild) { same(source.tail, ""); same(source.readChild(), next); source.writeChild(replacement); same(holder.item.readBase(), value); }
    holder.item.writeBase(next); same(source.readBase(), next);
    if (source instanceof SecretChild) { same(source.readChild(), replacement); source.writeChild(value); same(holder.item.readBase(), next); same(source.readChild(), value); }
    source.writeBase(replacement); same(holder.item.readBase(), replacement);
    if (source instanceof SecretLeaf) same(source.token, 0n);
  }
}
