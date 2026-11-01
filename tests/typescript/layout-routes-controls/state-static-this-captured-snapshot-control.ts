/*---
description: "Control for state-static-this-captured-snapshot; replace layouts and brands by plain records and explicit state."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-type-aliases, ts-optional-properties, ts-closures]
---*/
// Use kind-tagged public literals and separate private or static records; retain the same values, state changes and identity observations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
type SnapshotData = { kind: string; payload: unknown; shared: { value: unknown }; tail?: string; token?: bigint };
const root: SnapshotData = { kind: "root", payload: undefined, shared: { value: undefined } }, child: SnapshotData = { kind: "child", payload: undefined, shared: root.shared, tail: "" }, leaf: SnapshotData = { kind: "leaf", payload: undefined, shared: { value: undefined }, tail: "", token: 0n };
function capture(receiver: SnapshotData) { return () => ({ owner: receiver, value: receiver.payload, shared: receiver.shared }); }
for (let index = 0; index < values.length; index++) {
  const value = values[index], next = values[(index + 1) % values.length], rootRef = { value }, leafRef = { value: next };
  root.shared = rootRef; child.shared = rootRef; leaf.shared = leafRef;
  const entries = [{ receiver: root, kind: "root", shared: rootRef }, { receiver: child, kind: "child", shared: rootRef }, { receiver: leaf, kind: "leaf", shared: leafRef }];
  for (const entry of entries) {
    const receiver = entry.receiver; receiver.payload = value;
    const read = capture(receiver), before = read();
    same(receiver.kind, entry.kind); same(before.owner, receiver); same(before.value, value); same(before.shared, entry.shared); same(before.shared.value, entry.kind === "leaf" ? next : value);
    receiver.payload = next; receiver.shared.value = next;
    const after = read(); same(after.owner, receiver); same(after.value, next); same(after.shared, entry.shared); same(after.shared.value, next);
    same(before.value, value); same(before.shared.value, next); same(Object.is(before, after), false);
    receiver.shared.value = entry.kind === "leaf" ? next : value;
  }
  same(child.tail, ""); same(leaf.tail, ""); same(leaf.token, 0n); same(root.shared, rootRef); same(leaf.shared, leafRef);
}
