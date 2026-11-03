/*---
description: A bound callable parameter observes later replacements of its target’s prototype without retaining the previous chain. The control calls the hook or walks the target chain explicitly.
features: [ts-instanceof-routes, ts-instanceof-route-custom, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-symbols, ts-objects, ts-tuples, ts-function-types, ts-interfaces]
---*/
// An ordinary function and its binding share a typed pair parameter; node re-reads the target prototype on every check, so old and replacement chains swap answers. The control makes that decision explicitly.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let step: unknown = Object.getPrototypeOf(value);
  while ((typeof step === "object" && step !== null) || typeof step === "function") {
    if (step === prototype) return true;
    step = Object.getPrototypeOf(step);
  }
  return false;
}
interface Target { (): void; prototype: object; }
interface BoundPair { target: Target; bound: () => void; }
function original(): void {}
function accepts(pair: BoundPair, value: unknown): boolean { return follows(value, pair.target.prototype); }
const target: Target = original;
const prototypes: [object, object][] = [[{ tag: 1 }, { tag: 1 }], [[], {}], [() => 0, { tag: 2 }]];
for (const [before, after] of prototypes) {
  target.prototype = before; const pair: BoundPair = { target, bound: target.bind(null) };
  const oldObject: unknown = Object.create(before), newObject: unknown = Object.create(after), blank: unknown = Object.create(null);
  const values: unknown[] = [oldObject, newObject, before, after, blank, 0, null];
  const oldAnswers = [true, false, false, false, false, false, false], newAnswers = [false, true, false, false, false, false, false];
  assert.sameValue(Object.hasOwn(pair.bound, "prototype"), false);
  for (let i = 0; i < values.length; i++) { const matched = accepts(pair, values[i]); assert.sameValue(matched, oldAnswers[i]); }
  target.prototype = after; assert.sameValue(pair.target.prototype, after);
  for (let i = 0; i < values.length; i++) { const matched = accepts(pair, values[i]); assert.sameValue(matched, newAnswers[i]); }
}
