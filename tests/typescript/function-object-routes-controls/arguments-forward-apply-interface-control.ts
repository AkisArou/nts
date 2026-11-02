/*---
description: Explicit incoming-list control for an interface-held forwarding function materializes arguments for apply and preserves the target receiver identity.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-interfaces, ts-this-parameter, ts-rest-parameters, ts-spread]
---*/
// An interface field forwards explicit lists and self; the receiver counts and copies the incoming values.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

function takeIncoming(incoming: ArgValue[]): ArgSnapshot {
  const values: unknown[] = []; let count = 0;
  for (const value of incoming) { values.push(value); count++; }
  return { count, values };
}

interface ArgReceiver { marker: number; }
interface ArgResult extends ArgSnapshot { self: ArgReceiver; }
interface ArgForwarder { run: (values: ArgValue[]) => ArgResult; receiver: ArgReceiver; }
function receive(self: ArgReceiver, values: ArgValue[]): ArgResult { const raw = takeIncoming(values); return { self, count: raw.count, values: raw.values }; }
function make(receiver: ArgReceiver, alternate: boolean): ArgForwarder {
  function declared(incoming: ArgValue[]): ArgResult { return receive(receiver, incoming); }
  const expression = function (incoming: ArgValue[]): ArgResult { return receive(receiver, incoming); };
  return { run: alternate ? expression : declared, receiver };
}
function invoke(forwarder: ArgForwarder, input: ArgValue[]): ArgResult { return forwarder.run(input); }
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
