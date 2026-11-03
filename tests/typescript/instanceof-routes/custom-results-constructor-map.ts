/*---
description: A custom method with an unknown result is carried by a constructor-only Map view and its result becomes an exact boolean.
features: [ts-instanceof-routes, ts-instanceof-route-custom, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-symbols, ts-objects, ts-tuples, ts-class, ts-static, ts-map-set, ts-construct-signatures, ts-this, ts-bigint, ts-instanceof]
---*/
// ReplyGate crosses a Map of construct signatures; node converts every falsy and truthy hook result to boolean without inspecting the argument or coercing an object result.
const events: unknown[] = [];
class ReplyGate {
  static reply: unknown = undefined;
  static [Symbol.hasInstance](value: unknown): unknown { events.push(this, value); return this.reply; }
}
type Constructor = new () => object;
const choices = new Map<string, Constructor>([["active", ReplyGate]]);
function accepts(target: Constructor, value: unknown): boolean { return value instanceof target; }
const opaque = { valueOf(): never { throw new TypeError(); }, toString(): never { throw new TypeError(); } };
const replies: [unknown, boolean][] = [[false, false], [0, false], [-0, false], [NaN, false], [0n, false], ["", false], [null, false], [undefined, false], [true, true], [1, true], [-1, true], [1n, true], ["0", true], [Symbol("reply"), true], [{}, true], [[], true], [() => 0, true], [opaque, true]];
const values: unknown[] = [new ReplyGate(), {}, [], () => 0, null, undefined, false, 7, "", Symbol("argument")];
for (const [reply, expected] of replies) {
  ReplyGate.reply = reply; const target = choices.get("active");
  if (target === undefined) throw new Error("missing constructor");
  for (const value of values) {
    events.length = 0; const matched = accepts(target, value);
    assert.sameValue(matched, expected); assert.compareArray(events, [ReplyGate, value]); assert.sameValue(ReplyGate.reply, reply);
  }
}
