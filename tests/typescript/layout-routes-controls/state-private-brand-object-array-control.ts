/*---
description: "Control for state-private-brand-object-array; replace layouts and brands by plain records and explicit state."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-type-aliases, ts-optional-properties]
---*/
// Use kind-tagged public literals and separate private or static records; retain the same values, state changes and identity observations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
type BrandData = { kind: string; label?: string; count?: number; token?: bigint };
type BrandEntry = { data: BrandData; secret: { base: unknown; child: unknown; other: unknown } };
for (let index = 0; index < values.length; index++) {
  const value = values[index], next = values[(index + 1) % values.length];
  const sources: BrandEntry[] = [
    { data: { kind: "base", label: "" }, secret: { base: value, child: undefined, other: undefined } },
    { data: { kind: "child", label: "", count: -0 }, secret: { base: value, child: value, other: undefined } },
    { data: { kind: "other", token: 0n }, secret: { base: undefined, child: undefined, other: value } }
  ];
  for (let slot = 0; slot < sources.length; slot++) {
    const view = sources[slot].data, secret = sources[slot].secret; same(view, sources[slot].data);
    same(view.kind === "base" || view.kind === "child", slot !== 2); same(view.kind === "child", slot === 1); same(view.kind === "other", slot === 2);
    same(view.kind === "base" || view.kind === "child", slot !== 2); same(view.kind === "child", slot === 1); same(view.kind === "other", slot === 2);
    if (view.kind === "base" || view.kind === "child") { same(view.kind, slot === 0 ? "base" : "child"); same(view.label, ""); same(secret.base, value); secret.base = next; same(secret.base, next); }
    if (view.kind === "child") { same(view.count, -0); same(secret.child, value); }
    if (view.kind === "other") { same(view.kind, "other"); same(view.token, 0n); same(secret.other, value); secret.other = next; same(secret.other, next); }
  }
}
