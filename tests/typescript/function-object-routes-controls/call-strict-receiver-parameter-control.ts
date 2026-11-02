/*---
description: Explicit function-record control for An interface call signature preserves primitive, null and undefined receivers without boxing through call.
features: [ts-function-object-route-call-apply, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-interfaces, ts-this-parameter, ts-this, ts-unknown, ts-rest-parameters, ts-unions]
---*/
// Two functions cross a call-signature parameter; call keeps each strict receiver and every supplied value exactly.
type Value = number | string | undefined | null | { token: string };
interface Seen { self: unknown; items: Value[]; }
interface Callable { (self: unknown, items: Value[]): Seen; }
function collect(self: unknown, items: Value[]): Seen { return { self, items }; }
const second = function capture(self: unknown, items: Value[]): Seen { return { self, items }; };
function invoke(fn: Callable, receiver: unknown, items: Value[]): Seen { return fn(receiver, items.slice()); }
const choices: Callable[] = [collect, second];
const identity = { token: "original" }, receivers: unknown[] = [undefined, null, -0, NaN, "", "receiver", identity];
const inputs: Value[][] = [[], [undefined], [-0, NaN, "", identity, null]];
for (const fn of choices) for (const receiver of receivers) for (const items of inputs) {
  const result = invoke(fn, receiver, items);
  assert.sameValue(result.self, receiver); assert.compareArray(result.items, items);
  assert.sameValue(result.items === items, false); assert.sameValue(identity.token, "original");
}
