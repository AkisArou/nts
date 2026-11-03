/*---
description: A bound function from a Map entry delegates the default instance check to the original target’s own custom hook.
features: [ts-instanceof-routes, ts-instanceof-route-custom, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-symbols, ts-objects, ts-tuples, ts-class-expression, ts-static, ts-closures, ts-construct-signatures, ts-interfaces, ts-map-set, ts-this, ts-instanceof]
---*/
// Two fresh HookTarget constructors cross a Map entry after binding; node invokes the original target’s own hook with that target as receiver and the unchanged argument.
const events: unknown[] = [], marker = { key: 1 };
interface HookConstructor { new (): object; [Symbol.hasInstance](value: unknown): boolean; }
interface BoundEntry { target: HookConstructor; bound: new () => object; }
function make(accepted: unknown): HookConstructor {
  return class HookTarget { static [Symbol.hasInstance](value: unknown): boolean { events.push(this, value); return Object.is(value, accepted); } };
}
function accepts(entry: BoundEntry, value: unknown): boolean { return value instanceof entry.bound; }
const first = make(marker), second = make(-0);
const entries = new Map<string, BoundEntry>([["first", { target: first, bound: first.bind(null) }], ["second", { target: second, bound: second.bind(null) }]]);
const values: unknown[] = [marker, { key: 1 }, -0, 0, new first(), new second(), [], () => 0, null, undefined];
const choices: [string, boolean[]][] = [["first", [true, false, false, false, false, false, false, false, false, false]], ["second", [false, false, true, false, false, false, false, false, false, false]]];
for (const [key, answers] of choices) {
  const entry = entries.get(key); if (entry === undefined) throw new Error("missing bound target");
  assert.sameValue(Object.hasOwn(entry.bound, "prototype"), false);
  for (let i = 0; i < values.length; i++) {
    events.length = 0; const value = values[i], matched = accepts(entry, value);
    assert.sameValue(matched, answers[i]); assert.compareArray(events, [entry.target, value]);
  }
}
