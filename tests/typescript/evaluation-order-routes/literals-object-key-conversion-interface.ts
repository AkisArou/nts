/*---
description: "An object literal converts its computed key before evaluating the value through an interface slot."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-objects, ts-record, ts-computed-keys, ts-unsound-object-assign, ts-typeof-operator, ts-to-primitive, ts-conversions]
---*/
// A computed key crosses a string-declared interface field after ordinary Object.assign replacement; node logs key conversion before the value observes its mutation.
const log: string[] = [];
interface Slot { key: string; }
let current = 0;
function key(slot: Slot): string { log.push("key"); return slot.key; }
function value(slot: Slot): number { log.push("value"); slot.key = "later"; return current; }
function build(slot: Slot): Record<string, number> {
  log.push("build");
  return { [key(slot)]: value(slot) };
}
for (const input of [0, 7]) {
  log.length = 0; current = input; const slot: Slot = { key: "initial" };
  Object.assign(slot, { key: { toString(): string { log.push("toString"); current += 10; return "chosen"; } } });
  const result = build(slot);
  assert.compareArray(log, ["build", "key", "toString", "value"]);
  assert.sameValue(result.chosen, input + 10); assert.sameValue(typeof result.chosen, "number"); assert.sameValue(slot.key, "later"); assert.sameValue(current, input + 10); assert.compareArray(Object.keys(result), ["chosen"]);
}
