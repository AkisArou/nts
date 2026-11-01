/*---
description: "Control for state-private-same-name-base-field; replace layouts and brands by plain records and explicit state."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-type-aliases, ts-optional-properties]
---*/
// Use kind-tagged public literals and separate private or static records; retain the same values, state changes and identity observations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
type SecretData = { kind: string; head: number; tail?: string; token?: bigint };
type SecretEntry = { source: SecretData; secret: { base: unknown; child: unknown }; kind: string };
for (let index = 0; index < values.length; index++) {
  const value = values[index], next = values[(index + 1) % values.length], replacement = values[(index + 2) % values.length];
  const entries: SecretEntry[] = [
    { source: { kind: "base", head: -0 }, secret: { base: value, child: undefined }, kind: "base" },
    { source: { kind: "child", head: -0, tail: "" }, secret: { base: value, child: next }, kind: "child" },
    { source: { kind: "leaf", head: -0, tail: "", token: 0n }, secret: { base: value, child: next }, kind: "leaf" }
  ];
  for (const entry of entries) {
    const source = entry.source, holder: { item: SecretData } = { item: source }, secret = entry.secret;
    same(holder.item, source); same(holder.item.kind, entry.kind); same(holder.item.head, -0); same(secret.base, value);
    same(["base", "child", "leaf"].includes(holder.item.kind), true); same(holder.item.kind !== "base", entry.kind !== "base"); same(holder.item.kind === "leaf", entry.kind === "leaf");
    if (source.kind !== "base") { same(source.tail, ""); same(secret.child, next); secret.child = replacement; same(secret.base, value); }
    secret.base = next; same(secret.base, next);
    if (source.kind !== "base") { same(secret.child, replacement); secret.child = value; same(secret.base, next); same(secret.child, value); }
    secret.base = replacement; same(secret.base, replacement);
    if (source.kind === "leaf") same(source.token, 0n);
  }
}
