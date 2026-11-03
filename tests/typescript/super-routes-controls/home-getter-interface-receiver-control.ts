/*---
description: An object-literal getter reads through its original home prototype while an interface parameter supplies an unrelated receiver. The control uses Reflect.get on the current home prototype with the same this.
features: [ts-super-routes, ts-super-route-home, ts-objects, ts-interfaces, ts-accessors, ts-functions, ts-this, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// super.value in the literal getter crosses a State parameter via Reflect.get; node returns each receiver payload and bypasses its decoy getter. The control resolves the original home prototype at each use.
interface State { raw: unknown; }
const log: unknown[] = [];
const base = { raw: -100, get value(): unknown { log.push("base.get", this); return this.raw; } };
const decoy = { get value(): unknown { log.push("decoy.get", this); return "wrong"; } };
const home = { __proto__: base, raw: -200,
  get value(): unknown { log.push("home.get", this); const prototype: object = Object.getPrototypeOf(home); const value: unknown = Reflect.get(prototype, "value", this); return value; } };
function read(receiver: State): unknown { const value: unknown = Reflect.get(home, "value", receiver); return value; }
const token = { id: 1 };
const entries: [unknown, string][] = [[-0, "number"], [NaN, "number"], ["text", "string"], [0n, "bigint"],
  [undefined, "undefined"], [null, "object"], [false, "boolean"], [token, "object"]];
for (const [payload, kind] of entries) {
  const receiver = { __proto__: decoy, raw: payload };
  log.length = 0;
  const result = read(receiver);
  assert.sameValue(result, payload); assert.sameValue(typeof result, kind);
  assert.sameValue(receiver.raw, payload); assert.sameValue(typeof receiver.raw, kind);
  assert.sameValue(base.raw, -100); assert.sameValue(home.raw, -200);
  assert.sameValue(Object.hasOwn(receiver, "value"), false);
  assert.sameValue(Object.hasOwn(home, "value"), true); assert.sameValue(Object.hasOwn(base, "value"), true);
  assert.compareArray(log, ["home.get", receiver, "base.get", receiver]);
}
