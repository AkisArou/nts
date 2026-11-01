/*---
description: "A private accessor retains its payload when a public accessor is reached through an interface field."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-private-fields, ts-accessors, ts-interfaces, ts-instanceof, ts-narrowing, ts-object-type]
---*/
// AccessorBase, AccessorChild and AccessorLeaf expose #current through an interface property; writes through the interface and original object observe the same private slot.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
interface SecretPort { kind: string; value: unknown; }
class AccessorBase implements SecretPort {
  kind: string = "base"; head: number = -0; #slot: unknown;
  constructor(value: unknown) { this.#slot = value; }
  get #current(): unknown { return this.#slot; } set #current(value: unknown) { this.#slot = value; }
  get value(): unknown { return this.#current; } set value(value: unknown) { this.#current = value; }
}
class AccessorChild extends AccessorBase { override kind: string = "child"; tail: string = ""; }
class AccessorLeaf extends AccessorChild { override kind: string = "leaf"; ref: object; constructor(value: unknown, ref: object) { super(value); this.ref = ref; } }
for (let index = 0; index < values.length; index++) {
  const value = values[index], next = values[(index + 1) % values.length], ref = { id: index };
  const entries: { source: AccessorBase; kind: string }[] = [{ source: new AccessorBase(value), kind: "base" }, { source: new AccessorChild(value), kind: "child" }, { source: new AccessorLeaf(value, ref), kind: "leaf" }];
  for (const entry of entries) {
    const source = entry.source, holder: { port: SecretPort } = { port: source };
    same(holder.port, source); same(holder.port.kind, entry.kind); same(holder.port.value, value); same(source.head, -0);
    same(holder.port instanceof AccessorBase, true); same(holder.port instanceof AccessorChild, entry.kind !== "base"); same(holder.port instanceof AccessorLeaf, entry.kind === "leaf");
    holder.port.value = next; same(source.value, next); source.value = value; same(holder.port.value, value);
    if (source instanceof AccessorChild) same(source.tail, "");
    if (source instanceof AccessorLeaf) same(source.ref, ref);
    same(holder.port.kind, entry.kind); same(source.head, -0);
  }
}
