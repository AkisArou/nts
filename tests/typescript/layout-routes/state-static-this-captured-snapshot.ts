/*---
description: "A captured constructor reader returns receiver-relative static values and live reference identities."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-static, ts-typeof-type, ts-this, ts-closures]
---*/
// SnapshotRoot, SnapshotChild and SnapshotLeaf inherit one static snapshot method; typed closures retain their constructor and read updated payload slots while older snapshots retain their captured values.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
class SnapshotRoot {
  static kind: string = "root"; static payload: unknown = undefined; static shared: { value: unknown } = { value: undefined };
  static read() { return { owner: this, value: this.payload, shared: this.shared }; }
}
class SnapshotChild extends SnapshotRoot { static override kind: string = "child"; static tail: string = ""; static override payload: unknown = undefined; }
class SnapshotLeaf extends SnapshotChild { static override kind: string = "leaf"; static token: bigint = 0n; static override payload: unknown = undefined; static override shared: { value: unknown } = { value: undefined }; }
function capture(receiver: typeof SnapshotRoot) { return () => receiver.read(); }
for (let index = 0; index < values.length; index++) {
  const value = values[index], next = values[(index + 1) % values.length], rootRef = { value }, leafRef = { value: next };
  SnapshotRoot.shared = rootRef; SnapshotLeaf.shared = leafRef;
  const entries = [{ receiver: SnapshotRoot, kind: "root", shared: rootRef }, { receiver: SnapshotChild, kind: "child", shared: rootRef }, { receiver: SnapshotLeaf, kind: "leaf", shared: leafRef }];
  for (const entry of entries) {
    const receiver: typeof SnapshotRoot = entry.receiver; receiver.payload = value;
    const read = capture(receiver), before = read();
    same(receiver.kind, entry.kind); same(before.owner, receiver); same(before.value, value); same(before.shared, entry.shared); same(before.shared.value, entry.kind === "leaf" ? next : value);
    receiver.payload = next; receiver.shared.value = next;
    const after = read(); same(after.owner, receiver); same(after.value, next); same(after.shared, entry.shared); same(after.shared.value, next);
    same(before.value, value); same(before.shared.value, next); same(Object.is(before, after), false);
    receiver.shared.value = entry.kind === "leaf" ? next : value;
  }
  same(SnapshotChild.tail, ""); same(SnapshotLeaf.tail, ""); same(SnapshotLeaf.token, 0n); same(SnapshotRoot.shared, rootRef); same(SnapshotLeaf.shared, leafRef);
}
