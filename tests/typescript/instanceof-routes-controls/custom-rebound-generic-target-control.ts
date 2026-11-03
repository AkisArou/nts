/*---
description: A generic returned pair of once-bound and twice-bound constructors retains the original target for both checks. The control calls the hook or walks the target chain explicitly.
features: [ts-instanceof-routes, ts-instanceof-route-custom, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-symbols, ts-objects, ts-tuples, ts-class, ts-class-fields, ts-inheritance, ts-construct-signatures, ts-generics, ts-generic-constraints, ts-interfaces]
---*/
// ReboundBase and its child or sibling cross a generic binding return; node follows the same original target for either binding and neither binding gains an own prototype. The control makes that decision explicitly.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let step: unknown = Object.getPrototypeOf(value);
  while ((typeof step === "object" && step !== null) || typeof step === "function") {
    if (step === prototype) return true;
    step = Object.getPrototypeOf(step);
  }
  return false;
}
class ReboundBase { value: number = 1; }
class ReboundChild extends ReboundBase {}
class ReboundSibling { value: number = 1; }
type Constructor = { new (): object; readonly prototype: object; };
interface BoundPair<T extends Constructor> { target: T; first: T; second: T; }
function prepare<T extends Constructor>(target: T): BoundPair<T> { const first = target.bind(null), second = first.bind({}); return { target, first, second }; }
function observe<T extends Constructor>(pair: BoundPair<T>, value: unknown): boolean[] { return [follows(value, pair.target.prototype), follows(value, pair.target.prototype)]; }
const values: unknown[] = [new ReboundBase(), new ReboundChild(), new ReboundSibling(), { value: 1 }, [], () => 0, null, 0];
const choices: [Constructor, boolean[]][] = [[ReboundBase, [true, true, false, false, false, false, false, false]], [ReboundChild, [false, true, false, false, false, false, false, false]], [ReboundSibling, [false, false, true, false, false, false, false, false]]];
for (const [target, answers] of choices) {
  const pair = prepare(target);
  assert.sameValue(pair.target, target); assert.sameValue(Object.hasOwn(pair.first, "prototype"), false); assert.sameValue(Object.hasOwn(pair.second, "prototype"), false);
  for (let i = 0; i < values.length; i++) {
    const matched = observe(pair, values[i]); assert.compareArray(matched, [answers[i], answers[i]]);
  }
}
