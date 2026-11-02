/*---
description: Explicit incoming-list control for a function narrowed from a union forwards its complete arguments object with spread into a declared receiver.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-narrowing, ts-spread, ts-rest-parameters]
---*/
// A typeof-narrowed function forwards explicit incoming lists; the receiver copies and counts each value.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

function takeIncoming(incoming: ArgValue[]): ArgSnapshot {
  const values: unknown[] = []; let count = 0;
  for (const value of incoming) { values.push(value); count++; }
  return { count, values };
}

type ArgReader = (values: ArgValue[]) => ArgSnapshot;
function receive(values: ArgValue[]): ArgSnapshot { return takeIncoming(values); }
function declared(incoming: ArgValue[]): ArgSnapshot { return receive(incoming); }
const expression = function (incoming: ArgValue[]): ArgSnapshot { return receive(incoming); };
function invoke(reader: ArgReader | string, input: ArgValue[]): ArgSnapshot { if (typeof reader === "function") return reader(input); throw new TypeError("not a function"); }
const readers: (ArgReader | string)[] = [declared, expression];

const identity = { mark: 23 };
const rows: { input: ArgValue[]; count: number }[] = [
  { input: [], count: 0 }, { input: [undefined], count: 1 }, { input: [null], count: 1 },
  { input: [-0, NaN, undefined, identity, "tail"], count: 5 }, { input: [identity, "", 17], count: 3 }
];
for (const reader of readers) for (const row of rows) {
  const actual = invoke(reader, row.input);
  assert.sameValue(actual.count, row.count); assert.compareArray(actual.values, row.input);
  assert.sameValue(actual.values === row.input, false);
}
assert.throws(TypeError, () => invoke("not callable", []));
