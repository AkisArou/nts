/*---
description: An inherited static custom check reached through a generic constructor parameter overrides ancestry and preserves its receiver.
features: [ts-instanceof-routes, ts-instanceof-route-custom, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-symbols, ts-objects, ts-tuples, ts-class, ts-static, ts-inheritance, ts-generics, ts-generic-constraints, ts-this, ts-instanceof]
---*/
// HookBase and HookChild cross one generic constructor parameter; node calls the selected inherited hook once, accepting its exact wanted value and rejecting its own instances.
const events: unknown[] = [], marker = { key: 1 };
class HookBase {
  static wanted: unknown = marker;
  static [Symbol.hasInstance](value: unknown): boolean { events.push(this, value); return Object.is(value, this.wanted); }
}
class HookChild extends HookBase { static wanted: unknown = -0; }
function accepts<T extends typeof HookBase>(target: T, value: unknown): boolean { return value instanceof target; }
const values: unknown[] = [marker, { key: 1 }, -0, 0, new HookBase(), new HookChild(), [], () => 0, null, undefined];
const choices: [typeof HookBase, boolean[]][] = [[HookBase, [true, false, false, false, false, false, false, false, false, false]], [HookChild, [false, false, true, false, false, false, false, false, false, false]]];
for (const [target, answers] of choices) for (let i = 0; i < values.length; i++) {
  events.length = 0; const value = values[i], matched = accepts(target, value);
  assert.sameValue(matched, answers[i]); assert.compareArray(events, [target, value]);
}
