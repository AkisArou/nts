/*---
description: A generic noncallable matcher parameter forwards exact arguments and propagates a TypeError thrown one call inside its hook. The control calls the hook or walks the target chain explicitly.
features: [ts-instanceof-routes, ts-instanceof-route-custom, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-symbols, ts-objects, ts-tuples, ts-interfaces, ts-generics, ts-generic-constraints, ts-this, ts-errors]
---*/
// ThrowingGate objects cross a generic interface parameter; node calls the hook even for primitive operands, propagates its TypeError and preserves object identity decisions. The control makes that decision explicitly.
const events: unknown[] = [];
interface ThrowingGate { accepted: object; [Symbol.hasInstance](value: unknown): boolean; }
function decide(value: unknown, accepted: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") throw new TypeError();
  return value === accepted;
}
function accepts<T extends ThrowingGate>(target: T, value: unknown): boolean { return Boolean(target[Symbol.hasInstance](value)); }
for (const accepted of [{ key: 1 }, [1], () => 1]) {
  const target: ThrowingGate = { accepted, [Symbol.hasInstance](value: unknown): boolean { events.push(this, value); return decide(value, this.accepted); } };
  const entries: [unknown, boolean, boolean][] = [[accepted, true, false], [{ key: 1 }, false, false], [[], false, false], [() => 1, false, false], [accepted, true, false], [null, false, true], [undefined, false, true], [false, false, true], [0, false, true], ["", false, true], [0n, false, true], [Symbol("argument"), false, true]];
  for (const [value, expected, throws] of entries) {
    events.length = 0;
    if (throws) assert.throws(TypeError, () => { accepts(target, value); });
    else { const matched = accepts(target, value); assert.sameValue(matched, expected); }
    assert.compareArray(events, [target, value]); assert.sameValue(target.accepted, accepted);
  }
}
