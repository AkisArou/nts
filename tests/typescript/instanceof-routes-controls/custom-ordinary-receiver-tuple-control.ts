/*---
description: Direct intrinsic checks carried in an unknown receiver tuple return false for noncallable receivers without consulting their hooks. The control calls the hook or walks the target chain explicitly.
features: [ts-instanceof-routes, ts-instanceof-route-custom, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-symbols, ts-objects, ts-tuples, ts-class, ts-interfaces]
---*/
// An unknown receiver and operand share a tuple; node’s direct intrinsic answers false for noncallables, ignores an object’s custom hook and still recognizes a real constructor. The control makes that decision explicitly.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let step: unknown = Object.getPrototypeOf(value);
  while ((typeof step === "object" && step !== null) || typeof step === "function") {
    if (step === prototype) return true;
    step = Object.getPrototypeOf(step);
  }
  return false;
}
const events: unknown[] = [];
class OrdinaryMarker {}
const matcher = { [Symbol.hasInstance](value: unknown): boolean { events.push("custom", this, value); return true; } };
function ordinary(pair: [unknown, unknown]): boolean {
  events.push("direct", pair[0], pair[1]); const target = pair[0], value = pair[1];
  if (typeof target !== "function") return false;
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  const prototype: unknown = target.prototype;
  if ((typeof prototype !== "object" || prototype === null) && typeof prototype !== "function") throw new TypeError();
  return follows(value, prototype);
}
const blank: unknown = Object.create(null), instance = new OrdinaryMarker();
const receivers: unknown[] = [undefined, null, false, 0, "", 0n, Symbol("receiver"), {}, [], matcher, blank];
const entries: [unknown, unknown, boolean][] = [[OrdinaryMarker, instance, true], [OrdinaryMarker, OrdinaryMarker.prototype, false]];
for (const receiver of receivers) for (const value of [instance, matcher, null, 7]) entries.push([receiver, value, false]);
for (const [receiver, value, expected] of entries) {
  events.length = 0; const pair: [unknown, unknown] = [receiver, value], matched = ordinary(pair);
  assert.sameValue(matched, expected); assert.compareArray(events, ["direct", receiver, value]);
}
