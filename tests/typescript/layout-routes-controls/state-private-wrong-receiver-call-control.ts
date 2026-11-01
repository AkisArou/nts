/*---
description: "Control for state-private-wrong-receiver-call; replace layouts and brands by plain records and explicit state."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-type-aliases, ts-optional-properties, ts-errors, ts-closures]
---*/
// Use kind-tagged public literals and separate private or static records; retain the same values, state changes and identity observations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
type ReceiverData = { kind: string; head?: number; tail?: string; token?: bigint };
type ReceiverEntry = { receiver: ReceiverData; secret: { value: unknown }; valid: boolean; kind: string };
function read(receiver: ReceiverData, secret: { value: unknown }): unknown { if (receiver.kind === "stranger") throw new TypeError("private brand"); return secret.value; }
for (const value of values) {
  const owner: ReceiverData = { kind: "owner", head: -0 }, child: ReceiverData = { kind: "child", head: -0, tail: "" }, stranger: ReceiverData = { kind: "stranger", token: 0n };
  const entries: ReceiverEntry[] = [{ receiver: owner, secret: { value }, valid: true, kind: "owner" }, { receiver: child, secret: { value }, valid: true, kind: "child" }, { receiver: stranger, secret: { value }, valid: false, kind: "stranger" }];
  for (const entry of entries) {
    const receiver = entry.receiver, secret = entry.secret;
    same(receiver.kind === "owner" || receiver.kind === "child", entry.valid); same(receiver.kind === "child", entry.kind === "child"); same(receiver.kind === "stranger", entry.kind === "stranger");
    if (entry.valid) same(read(receiver, secret), value); else assert.throws(TypeError, () => read(receiver, secret));
    if (receiver.kind === "owner" || receiver.kind === "child") { same(receiver.kind, entry.kind); same(receiver.head, -0); same(secret.value, value); }
    if (receiver.kind === "child") same(receiver.tail, "");
    if (receiver.kind === "stranger") { same(receiver.kind, entry.kind); same(receiver.token, 0n); same(secret.value, value); }
  }
}
