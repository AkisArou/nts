/*---
description: Explicit incoming-list control for an interface method route keeps the actual method receiver separate from every raw argument in classes and literals.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-rest-parameters, ts-optional-parameters]
---*/
// Interface methods receive explicit self and lists; receiver identity stays separate from the incoming data.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

function takeIncoming(incoming: ArgValue[]): ArgSnapshot {
  const values: unknown[] = []; let count = 0;
  for (const value of incoming) { values.push(value); count++; }
  return { count, values };
}

interface ArgResult extends ArgSnapshot { self: ArgInspector; }
interface ArgInspector { marker: number; inspect(self: ArgInspector, values: ArgValue[]): ArgResult; }
class ArgOne implements ArgInspector { marker: number = 1; inspect(self: ArgInspector, incoming: ArgValue[]): ArgResult { const raw = takeIncoming(incoming); return { self, count: raw.count, values: raw.values }; } }
class ArgThree implements ArgInspector { marker: number = 3; inspect(self: ArgInspector, incoming: ArgValue[]): ArgResult { const raw = takeIncoming(incoming); return { self, count: raw.count, values: raw.values }; } }
const literal: ArgInspector = { marker: 0, inspect(self: ArgInspector, incoming: ArgValue[]): ArgResult { const raw = takeIncoming(incoming); return { self, count: raw.count, values: raw.values }; } };
const inspectors: ArgInspector[] = [new ArgOne(), new ArgThree(), literal];
function invoke(inspector: ArgInspector, input: ArgValue[]): ArgResult { return inspector.inspect(inspector, input); }

const identity = { mark: 23 };
const rows: { input: ArgValue[]; count: number }[] = [
  { input: [], count: 0 }, { input: [undefined], count: 1 }, { input: [null], count: 1 },
  { input: [-0, NaN, undefined, identity, "tail"], count: 5 }, { input: [identity, "", 17], count: 3 }
];
for (const inspector of inspectors) for (const row of rows) {
  const actual = invoke(inspector, row.input);
  assert.sameValue(actual.self, inspector); assert.sameValue(actual.count, row.count);
  assert.compareArray(actual.values, row.input); assert.sameValue(actual.values === row.input, false);
}
