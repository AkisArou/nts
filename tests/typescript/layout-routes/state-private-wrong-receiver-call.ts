/*---
description: "An extracted private-field reader accepts related layouts and rejects an unrelated private brand."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-private-fields, ts-instanceof, ts-narrowing, ts-object-type, ts-this-parameter, ts-this, ts-errors, ts-closures]
---*/
// Owner, Child and Stranger each carry different public fields; a typed extracted reader called with object receivers returns the owner slot or throws TypeError for Stranger.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
class PrivateOwner {
  kind: string = "owner"; head: number = -0; #value: unknown;
  constructor(value: unknown) { this.#value = value; } read(): unknown { return this.#value; }
}
class PrivateChild extends PrivateOwner { override kind: string = "child"; tail: string = ""; }
class PrivateStranger {
  kind: string = "stranger"; token: bigint = 0n; #value: unknown;
  constructor(value: unknown) { this.#value = value; } read(): unknown { return this.#value; }
}
for (const value of values) {
  const owner = new PrivateOwner(value), child = new PrivateChild(value), stranger = new PrivateStranger(value);
  const read: (this: object) => unknown = owner.read;
  const entries: { receiver: object; valid: boolean; kind: string }[] = [{ receiver: owner, valid: true, kind: "owner" }, { receiver: child, valid: true, kind: "child" }, { receiver: stranger, valid: false, kind: "stranger" }];
  for (const entry of entries) {
    const receiver: object = entry.receiver;
    same(receiver instanceof PrivateOwner, entry.valid); same(receiver instanceof PrivateChild, entry.kind === "child"); same(receiver instanceof PrivateStranger, entry.kind === "stranger");
    if (entry.valid) same(read.call(receiver), value); else assert.throws(TypeError, () => read.call(receiver));
    if (receiver instanceof PrivateOwner) { same(receiver.kind, entry.kind); same(receiver.head, -0); same(receiver.read(), value); }
    if (receiver instanceof PrivateChild) same(receiver.tail, "");
    if (receiver instanceof PrivateStranger) { same(receiver.kind, entry.kind); same(receiver.token, 0n); same(receiver.read(), value); }
  }
}
