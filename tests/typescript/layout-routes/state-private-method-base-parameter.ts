/*---
description: "A private exchange method preserves the old and new payload through a base-class parameter."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-private-fields, ts-instanceof, ts-narrowing, ts-object-type]
---*/
// MethodBase, MethodChild and MethodLeaf add public fields around a private payload; the same typed consumer exchanges it without changing identity or adjacent fields.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
class MethodBase {
  kind: string = "base"; head: number = -0; #value: unknown;
  constructor(value: unknown) { this.#value = value; }
  #exchange(next: unknown): unknown { const previous = this.#value; this.#value = next; return previous; }
  exchange(next: unknown): unknown { return this.#exchange(next); } read(): unknown { return this.#value; }
}
class MethodChild extends MethodBase { override kind: string = "child"; tail: string = ""; }
class MethodLeaf extends MethodChild { override kind: string = "leaf"; ref: object; constructor(value: unknown, ref: object) { super(value); this.ref = ref; } }
function exchange(value: MethodBase, next: unknown): unknown { return value.exchange(next); }
for (let index = 0; index < values.length; index++) {
  const value = values[index], next = values[(index + 1) % values.length], ref = { id: index };
  const entries: { source: MethodBase; kind: string }[] = [{ source: new MethodBase(value), kind: "base" }, { source: new MethodChild(value), kind: "child" }, { source: new MethodLeaf(value, ref), kind: "leaf" }];
  for (const entry of entries) {
    const source = entry.source, alias: MethodBase = source;
    same(alias, source); same(alias.kind, entry.kind); same(alias.head, -0); same(alias.read(), value);
    same(alias instanceof MethodBase, true); same(alias instanceof MethodChild, entry.kind !== "base"); same(alias instanceof MethodLeaf, entry.kind === "leaf");
    same(exchange(alias, next), value); same(source.read(), next); same(source.exchange(value), next); same(alias.read(), value);
    if (source instanceof MethodChild) same(source.tail, "");
    if (source instanceof MethodLeaf) same(source.ref, ref);
    same(alias.kind, entry.kind); same(alias.head, -0);
  }
}
