/*---
description: "An inherited static reference stays shared until one constructor replaces its own slot."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-static, ts-typeof-type]
---*/
// StaticRoot, StaticChild and StaticLeaf add static fields; a typeof-root array mutates a shared record, then a child rebind separates its record from the base while the leaf follows the child.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
for (let index = 0; index < values.length; index++) {
  const value = values[index], next = values[(index + 1) % values.length];
  class StaticRoot { static kind: string = "root"; static head: number = -0; static shared: { value: unknown } = { value }; }
  class StaticChild extends StaticRoot { static override kind: string = "child"; static tail: string = ""; }
  class StaticLeaf extends StaticChild { static override kind: string = "leaf"; static token: bigint = 0n; }
  const original = StaticRoot.shared, replacement = { value: next };
  const entries: { receiver: typeof StaticRoot; kind: string }[] = [{ receiver: StaticRoot, kind: "root" }, { receiver: StaticChild, kind: "child" }, { receiver: StaticLeaf, kind: "leaf" }];
  for (const entry of entries) {
    const receiver: typeof StaticRoot = entry.receiver;
    same(receiver.kind, entry.kind); same(receiver.head, -0); same(receiver.shared, original); same(receiver.shared.value, value);
    receiver.shared.value = next; same(StaticRoot.shared.value, next); same(StaticChild.shared.value, next); same(StaticLeaf.shared.value, next); receiver.shared.value = value;
  }
  same(StaticChild.tail, ""); same(StaticLeaf.tail, ""); same(StaticLeaf.token, 0n);
  StaticChild.shared = replacement;
  for (const entry of entries) {
    same(entry.receiver.shared, entry.kind === "root" ? original : replacement); same(entry.receiver.shared.value, entry.kind === "root" ? value : next);
    same(Object.hasOwn(entry.receiver, "shared"), entry.kind !== "leaf");
  }
  StaticLeaf.shared.value = value; same(StaticChild.shared.value, value); same(StaticRoot.shared, original); same(StaticChild.shared, replacement);
}
