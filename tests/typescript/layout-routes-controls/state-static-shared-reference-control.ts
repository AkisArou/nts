/*---
description: "Control for state-static-shared-reference; replace layouts and brands by plain records and explicit state."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-type-aliases, ts-optional-properties]
---*/
// Use kind-tagged public literals and separate private or static records; retain the same values, state changes and identity observations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
type StaticData = { kind: string; head: number; tail?: string; token?: bigint };
type SharedState = { own: boolean; slot: { value: unknown } };
for (let index = 0; index < values.length; index++) {
  const value = values[index], next = values[(index + 1) % values.length], original = { value }, replacement = { value: next };
  const root: StaticData = { kind: "root", head: -0 }, child: StaticData = { kind: "child", head: -0, tail: "" }, leaf: StaticData = { kind: "leaf", head: -0, tail: "", token: 0n };
  const rootState: SharedState = { own: true, slot: original }, childState: SharedState = { own: false, slot: original }, leafState: SharedState = { own: false, slot: original };
  const entries = [{ receiver: root, state: rootState, kind: "root" }, { receiver: child, state: childState, kind: "child" }, { receiver: leaf, state: leafState, kind: "leaf" }];
  for (const entry of entries) {
    const receiver = entry.receiver, shared = entry.state.slot;
    same(receiver.kind, entry.kind); same(receiver.head, -0); same(shared, original); same(shared.value, value);
    shared.value = next; same(rootState.slot.value, next); same(childState.slot.value, next); same(leafState.slot.value, next); shared.value = value;
  }
  same(child.tail, ""); same(leaf.tail, ""); same(leaf.token, 0n);
  childState.slot = replacement; childState.own = true; leafState.slot = replacement;
  for (const entry of entries) {
    same(entry.state.slot, entry.kind === "root" ? original : replacement); same(entry.state.slot.value, entry.kind === "root" ? value : next);
    same(entry.state.own, entry.kind !== "leaf");
  }
  leafState.slot.value = value; same(childState.slot.value, value); same(rootState.slot, original); same(childState.slot, replacement);
}
