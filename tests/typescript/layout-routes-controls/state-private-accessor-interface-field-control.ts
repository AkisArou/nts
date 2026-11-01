/*---
description: "Control for state-private-accessor-interface-field; replace layouts and brands by plain records and explicit state."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-type-aliases, ts-optional-properties, ts-object-type]
---*/
// Use kind-tagged public literals and separate private or static records; retain the same values, state changes and identity observations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
type AccessorData = { kind: string; head: number; tail?: string; ref?: object };
type AccessorEntry = { source: AccessorData; secret: { slot: unknown }; kind: string };
for (let index = 0; index < values.length; index++) {
  const value = values[index], next = values[(index + 1) % values.length], ref = { id: index };
  const entries: AccessorEntry[] = [
    { source: { kind: "base", head: -0 }, secret: { slot: value }, kind: "base" },
    { source: { kind: "child", head: -0, tail: "" }, secret: { slot: value }, kind: "child" },
    { source: { kind: "leaf", head: -0, tail: "", ref }, secret: { slot: value }, kind: "leaf" }
  ];
  for (const entry of entries) {
    const source = entry.source, holder: { port: { kind: string } } = { port: source }, secret = entry.secret;
    same(holder.port, source); same(holder.port.kind, entry.kind); same(secret.slot, value); same(source.head, -0);
    same(["base", "child", "leaf"].includes(holder.port.kind), true); same(holder.port.kind !== "base", entry.kind !== "base"); same(holder.port.kind === "leaf", entry.kind === "leaf");
    secret.slot = next; same(secret.slot, next); secret.slot = value; same(secret.slot, value);
    if (source.kind !== "base") same(source.tail, "");
    if (source.kind === "leaf") same(source.ref, ref);
    same(holder.port.kind, entry.kind); same(source.head, -0);
  }
}
