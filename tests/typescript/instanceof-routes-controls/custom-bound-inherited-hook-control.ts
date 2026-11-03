/*---
description: A bound subclass inherits its base’s custom hook and calls it with the bound function receiver before target delegation. The control calls the hook or walks the target chain explicitly.
features: [ts-instanceof-routes, ts-instanceof-route-custom, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-symbols, ts-objects, ts-tuples, ts-class, ts-static, ts-inheritance, ts-this, ts-construct-signatures]
---*/
// BoundHook and its bound subclass cross a constructor tuple; node calls the inherited hook on the actual right operand, whose inherited wanted value differs from the unbound child’s. The control makes that decision explicitly.
const events: unknown[] = [], marker = { key: 1 };
class BoundHook {
  static wanted: unknown = marker;
  static [Symbol.hasInstance](value: unknown): boolean { events.push(this, value, this.wanted); return Object.is(value, this.wanted); }
}
class HookChild extends BoundHook { static wanted: unknown = 7; }
const Bound = HookChild.bind(null);
function accepts(pair: [typeof BoundHook, unknown]): boolean { return Boolean(pair[0][Symbol.hasInstance](pair[1])); }
assert.sameValue(Object.hasOwn(Bound, "prototype"), false); assert.sameValue(Bound.prototype, BoundHook.prototype);
const values: unknown[] = [marker, { key: 1 }, 7, new BoundHook(), new HookChild(), [], () => 0, null];
const choices: [typeof BoundHook, unknown, boolean[]][] = [[HookChild, 7, [false, false, true, false, false, false, false, false]], [Bound, marker, [true, false, false, false, false, false, false, false]]];
for (const [target, wanted, answers] of choices) for (let i = 0; i < values.length; i++) {
  events.length = 0; const value = values[i], pair: [typeof BoundHook, unknown] = [target, value], matched = accepts(pair);
  assert.sameValue(matched, answers[i]); assert.compareArray(events, [target, value, wanted]);
}
