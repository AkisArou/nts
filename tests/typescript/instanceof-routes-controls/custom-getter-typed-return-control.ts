/*---
description: A getter produces a custom check on each use of an interface returned from a factory, retaining lookup and invocation order. The control calls the hook or walks the target chain explicitly.
features: [ts-instanceof-routes, ts-instanceof-route-custom, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-symbols, ts-objects, ts-tuples, ts-class, ts-class-fields, ts-accessors, ts-interfaces, ts-function-types, ts-this, ts-this-parameter, ts-closures]
---*/
// AlternatingMatcher is returned as a Matcher interface; node looks up and calls a fresh hook each time with the matcher receiver and the unchanged argument. The control makes that decision explicitly.
const events: unknown[] = [];
interface Matcher { [Symbol.hasInstance](value: unknown): boolean; }
class AlternatingMatcher {
  turn: number = 0;
  get [Symbol.hasInstance](): (this: Matcher, value: unknown) => boolean {
    events.push("get", this); const answer = ++this.turn % 2 === 1;
    return function(this: Matcher, value: unknown): boolean { events.push("call", this, value); return answer; };
  }
}
function make(): Matcher { return new AlternatingMatcher(); }
function accepts(target: Matcher, value: unknown): boolean { return Boolean(target[Symbol.hasInstance](value)); }
const values: unknown[] = [{}, [], () => 1, null, undefined, false, 0, "", Symbol("argument")];
for (const value of values) {
  const target = make(); events.length = 0;
  const first = accepts(target, value), second = accepts(target, value);
  assert.sameValue(first, true); assert.sameValue(second, false);
  assert.compareArray(events, ["get", target, "call", target, value, "get", target, "call", target, value]);
}
