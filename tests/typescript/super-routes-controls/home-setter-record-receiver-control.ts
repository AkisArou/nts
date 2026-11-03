/*---
description: An object-literal setter forwards each payload through its home prototype to a Record receiver without creating an own accessor property. The control uses Reflect.set on the current home prototype and TypeError on false.
features: [ts-super-routes, ts-super-route-home, ts-objects, ts-record, ts-accessors, ts-this, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-typeof-operator, ts-errors]
---*/
// super.value assignment in the literal setter crosses a Record receiver; node calls both setters with that receiver and changes only its raw field. The control resolves the original home prototype at each use.
const log: unknown[] = [];
const base: { raw: unknown; value: unknown } = { raw: "base",
  set value(value: unknown) { log.push("base.set", this, value); this.raw = value; } };
const home = { __proto__: base, raw: "home",
  set value(value: unknown) { log.push("home.set", this, value); const prototype: object = Object.getPrototypeOf(home); if (!Reflect.set(prototype, "value", value, this)) throw new TypeError(); } };
const token = { id: 1 };
const entries: [unknown, string][] = [[-0, "number"], [NaN, "number"], ["text", "string"], [0n, "bigint"],
  [undefined, "undefined"], [null, "object"], [false, "boolean"], [token, "object"]];
for (const [payload, kind] of entries) {
  const receiver: Record<"raw", unknown> = { raw: "old" };
  log.length = 0;
  const accepted: boolean = Reflect.set(home, "value", payload, receiver);
  assert.sameValue(accepted, true); assert.sameValue(typeof accepted, "boolean");
  assert.sameValue(receiver.raw, payload); assert.sameValue(typeof receiver.raw, kind);
  assert.sameValue(Object.hasOwn(receiver, "raw"), true); assert.sameValue(Object.hasOwn(receiver, "value"), false);
  assert.sameValue(base.raw, "base"); assert.sameValue(home.raw, "home");
  assert.sameValue(base.value, undefined); assert.sameValue(typeof base.value, "undefined");
  assert.sameValue(Object.hasOwn(base, "value"), true); assert.sameValue(Object.hasOwn(home, "value"), true);
  assert.compareArray(log, ["home.set", receiver, payload, "base.set", receiver, payload]);
}
