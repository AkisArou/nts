/*---
description: Object.assign replaces an original narrow interface-held target while retaining getter order, intermediate writes and target identity. The control uses an unknown target field from construction through the original read.
features: [ts-type-form-routes, ts-type-form-route-signatures, ts-interfaces, ts-objects, ts-accessors, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// Object.assign writes through Slot.current while its value stays statically numeric; node reads each replacement and logs both getters around the intermediate value 3. The control uses an unknown target field from construction through the original read.
interface Slot { current: { value: unknown; kept: string }; }
const token = { id: 1 };
const entries: [unknown, string][] = [["tail", "string"], [false, "boolean"], [0n, "bigint"],
  [undefined, "undefined"], [null, "object"], [-0, "number"], [NaN, "number"], [token, "object"]];
for (const [payload, kind] of entries) {
  const log: unknown[] = [], slot: Slot = { current: { value: 11, kept: "stay" } };
  const returned = Object.assign(slot.current,
    { get value(): number { log.push("first"); return 3; } },
    { get value(): unknown { log.push("second", slot.current.value); return payload; } });
  const value: unknown = slot.current.value;
  assert.sameValue(returned, slot.current); assert.sameValue(typeof returned, "object");
  assert.sameValue(value, payload); assert.sameValue(typeof value, kind);
  assert.sameValue(slot.current.kept, "stay"); assert.sameValue(typeof slot.current.kept, "string");
  assert.compareArray(log, ["first", "second", 3]);
}
