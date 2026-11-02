/*---
description: Explicit function-record control for A typeof-narrowed function union forwards its complete argument list and exact receiver through call.
features: [ts-function-object-route-call-apply, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unions, ts-this-parameter, ts-this, ts-rest-parameters, ts-unknown]
---*/
// A union-typed array carries two callable forms and text; only narrowed functions dispatch call, preserving all values.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
type Callback = (self: Receiver, items: Value[]) => Seen;
function collect(self: Receiver, items: Value[]): Seen { return { self, items }; }
const owner = { method(self: Receiver, items: Value[]): Seen { return { self, items }; } };
type Choice = Callback | string;
function invoke(choice: Choice, receiver: Receiver, items: Value[]): Seen | string { return typeof choice === "function" ? choice(receiver, items.slice()) : choice; }
const choices: Choice[] = [collect, "not a function", owner.method];
const identity = { token: "identity" }, inputs: Value[][] = [[], [-0], [undefined, NaN, identity, null]];
for (const choice of choices) for (const items of inputs) {
  const receiver: Receiver = { tag: "chosen" }, result = invoke(choice, receiver, items);
  assert.sameValue(typeof result === "string", typeof choice === "string");
  if (typeof result === "string") assert.sameValue(result, "not a function");
  else { assert.sameValue(result.self, receiver); assert.compareArray(result.items, items); assert.sameValue(result.items === items, false); }
}
