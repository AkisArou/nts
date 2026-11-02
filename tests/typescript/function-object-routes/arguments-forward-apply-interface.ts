/*---
description: An interface-held forwarding function materializes arguments for apply and preserves the target receiver identity.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-interfaces, ts-this-parameter, ts-rest-parameters, ts-spread]
---*/
// An interface field forwards Array.from(arguments) through apply; node preserves the complete list and explicit receiver.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

interface ArgReceiver { marker: number; }
interface ArgResult extends ArgSnapshot { self: ArgReceiver; }
interface ArgForwarder { run: (...values: ArgValue[]) => ArgResult; receiver: ArgReceiver; }
function receive(this: ArgReceiver, ...values: unknown[]): ArgResult { return { self: this, count: values.length, values }; }
function make(receiver: ArgReceiver, alternate: boolean): ArgForwarder {
  function declared(): ArgResult { return receive.apply(receiver, Array.from(arguments)); }
  const expression = function (first?: ArgValue): ArgResult { return receive.apply(receiver, Array.from(arguments)); };
  return { run: alternate ? expression : declared, receiver };
}
function invoke(forwarder: ArgForwarder, input: ArgValue[]): ArgResult { return forwarder.run(...input); }
const receivers: ArgReceiver[] = [{ marker: -1 }, { marker: 17 }];

const identity = { mark: 23 };
const rows: { input: ArgValue[]; count: number }[] = [
  { input: [], count: 0 }, { input: [undefined], count: 1 }, { input: [null], count: 1 },
  { input: [-0, NaN, undefined, identity, "tail"], count: 5 }, { input: [identity, "", 17], count: 3 }
];
for (const receiver of receivers) for (const alternate of [false, true]) for (const row of rows) {
  const forwarder = make(receiver, alternate), actual = invoke(forwarder, row.input);
  assert.sameValue(actual.self, receiver); assert.sameValue(forwarder.receiver, receiver);
  assert.sameValue(actual.count, row.count); assert.compareArray(actual.values, row.input);
  assert.sameValue(actual.values === row.input, false);
}
