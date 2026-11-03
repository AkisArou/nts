/*---
description: A direct call of the intrinsic instance check walks a constructor parameter’s chain without invoking its custom override. The control calls the hook or walks the target chain explicitly.
features: [ts-instanceof-routes, ts-instanceof-route-custom, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-symbols, ts-objects, ts-tuples, ts-class, ts-static, ts-inheritance]
---*/
// DirectBase and DirectChild cross a constructor parameter; node’s directly called intrinsic uses their actual prototype chains and leaves the false custom hook uncalled. The control makes that decision explicitly.
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
class DirectBase { static [Symbol.hasInstance](value: unknown): boolean { events.push("custom", this, value); return false; } }
class DirectChild extends DirectBase {}
class Unrelated {}
function ordinary(target: typeof DirectBase, value: unknown): boolean {
  events.push("direct", target, value); return follows(value, target.prototype);
}
const made: unknown = Object.create(DirectChild.prototype);
const values: unknown[] = [new DirectBase(), new DirectChild(), new Unrelated(), made, DirectBase.prototype, DirectChild.prototype, {}, () => 0, null, 0];
const choices: [typeof DirectBase, boolean[]][] = [[DirectBase, [true, true, false, true, false, true, false, false, false, false]], [DirectChild, [false, true, false, true, false, false, false, false, false, false]]];
for (const [target, answers] of choices) for (let i = 0; i < values.length; i++) {
  const value = values[i]; events.length = 0; const matched = ordinary(target, value);
  assert.sameValue(matched, answers[i]); assert.compareArray(events, ["direct", target, value]);
}
