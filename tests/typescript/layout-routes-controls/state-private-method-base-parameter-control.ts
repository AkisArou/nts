/*---
description: "Control for state-private-method-base-parameter; replace layouts and brands by plain records and explicit state."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-type-aliases, ts-optional-properties, ts-object-type]
---*/
// Use kind-tagged public literals and separate private or static records; retain the same values, state changes and identity observations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
type MethodData = { kind: string; head: number; tail?: string; ref?: object };
type MethodEntry = { source: MethodData; secret: { value: unknown }; kind: string };
function exchange(secret: { value: unknown }, next: unknown): unknown { const previous = secret.value; secret.value = next; return previous; }
for (let index = 0; index < values.length; index++) {
  const value = values[index], next = values[(index + 1) % values.length], ref = { id: index };
  const entries: MethodEntry[] = [
    { source: { kind: "base", head: -0 }, secret: { value }, kind: "base" },
    { source: { kind: "child", head: -0, tail: "" }, secret: { value }, kind: "child" },
    { source: { kind: "leaf", head: -0, tail: "", ref }, secret: { value }, kind: "leaf" }
  ];
  for (const entry of entries) {
    const source = entry.source, alias: MethodData = source, secret = entry.secret;
    same(alias, source); same(alias.kind, entry.kind); same(alias.head, -0); same(secret.value, value);
    same(["base", "child", "leaf"].includes(alias.kind), true); same(alias.kind !== "base", entry.kind !== "base"); same(alias.kind === "leaf", entry.kind === "leaf");
    same(exchange(secret, next), value); same(secret.value, next); same(exchange(secret, value), next); same(secret.value, value);
    if (source.kind !== "base") same(source.tail, "");
    if (source.kind === "leaf") same(source.ref, ref);
    same(alias.kind, entry.kind); same(alias.head, -0);
  }
}
