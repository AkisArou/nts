/*---
description: A static method passed through an interface uses the supplied constructor-shaped receiver instead of its declaring class.
features: [ts-function-object-route-call-apply, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-interfaces, ts-class, ts-static, ts-this-parameter, ts-this, ts-tuples]
---*/
// Static functions cross an interface parameter; call uses the foreign static receiver and preserves the operand tuple.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
interface Callable { (this: Receiver, first: Value, second: Value): Seen; }
class Left { static tag: string = "left"; static inspect(this: Receiver, first: Value, second: Value): Seen { return { self: this, items: [first, second] }; } }
class Right { static tag: string = "right"; static inspect(this: Receiver, first: Value, second: Value): Seen { return { self: this, items: [first, second] }; } }
class Other { static tag: string = "other"; }
function invoke(fn: Callable, receiver: Receiver, items: [Value, Value]): Seen { return fn.call(receiver, ...items); }
const choices: Callable[] = [Left.inspect, Right.inspect];
const receivers: Receiver[] = [Left, Right, Other], identity = { token: "identity" }, inputs: [Value, Value][] = [[-0, NaN], [undefined, null], [identity, "end"]];
for (const fn of choices) for (const receiver of receivers) for (const items of inputs) {
  const result = invoke(fn, receiver, items);
  assert.sameValue(result.self, receiver); assert.compareArray(result.items, items);
  assert.sameValue(Left.tag, "left"); assert.sameValue(Right.tag, "right"); assert.sameValue(Other.tag, "other");
}
