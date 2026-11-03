/*---
description: Literal super writes over either inherited data or a missing property define or update the tuple-supplied receiver without changing either prototype.
features: [ts-super-routes, ts-super-route-home, ts-objects, ts-interfaces, ts-optional-properties, ts-functions, ts-this, ts-this-parameter, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// super.slot assignment crosses fresh and existing State tuple elements; node preserves the right-hand value and writes an own receiver slot for both current home prototypes.
interface State { label: string; slot?: unknown; }
const log: unknown[] = [], base = { slot: "prototype" }, empty = {};
const home = { __proto__: base, slot: "home",
  put(this: State, value: unknown): unknown { log.push("home.put", this, value); return super.slot = value; } };
const token = { id: 1 };
const entries: [unknown, string][] = [[-0, "number"], [NaN, "number"], ["text", "string"], [0n, "bigint"],
  [undefined, "undefined"], [null, "object"], [false, "boolean"], [token, "object"]];
for (const useData of [true, false]) for (const [payload, kind] of entries) {
  Object.setPrototypeOf(home, useData ? base : empty);
  const receivers: [State, State] = [{ label: "fresh" }, { label: "existing", slot: "old" }];
  for (const receiver of receivers) {
    log.length = 0;
    assert.sameValue(Object.hasOwn(receiver, "slot"), receiver.label === "existing");
    const result = home.put.call(receiver, payload);
    assert.sameValue(result, payload); assert.sameValue(typeof result, kind);
    assert.sameValue(receiver.slot, payload); assert.sameValue(typeof receiver.slot, kind);
    assert.sameValue(Object.hasOwn(receiver, "slot"), true);
    assert.sameValue(base.slot, "prototype"); assert.sameValue(typeof base.slot, "string");
    assert.sameValue(home.slot, "home"); assert.sameValue(Object.hasOwn(base, "slot"), true);
    assert.sameValue(Object.hasOwn(empty, "slot"), false);
    assert.compareArray(log, ["home.put", receiver, payload]);
  }
}
