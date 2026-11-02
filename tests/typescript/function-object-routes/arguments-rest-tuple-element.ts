/*---
description: Functions selected from a typed tuple retain all incoming arguments independently of their rest arrays.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-tuples, ts-rest-parameters, ts-optional-parameters]
---*/
// A tuple element carries a fixed-plus-rest function; node keeps the raw list independent when the rest array grows.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

function takeIncoming(incoming: IArguments): ArgSnapshot {
  const values: unknown[] = [];
  for (let index = 0; index < incoming.length; index++) { const value: unknown = incoming[index]; values.push(value); }
  return { count: incoming.length, values };
}

interface ArgResult { raw: ArgSnapshot; head: ArgValue; tail: ArgValue[]; grown: ArgValue[]; }
type ArgReader = (...values: ArgValue[]) => ArgResult;
function declared(head?: ArgValue, ...tail: ArgValue[]): ArgResult { const before = tail.slice(); tail.push("rest-only"); return { raw: takeIncoming(arguments), head, tail: before, grown: tail }; }
const expression = function (head?: ArgValue, ...tail: ArgValue[]): ArgResult { const before = tail.slice(); tail.push("rest-only"); return { raw: takeIncoming(arguments), head, tail: before, grown: tail }; };
const readers: [ArgReader, ArgReader] = [declared, expression];
function invoke(reader: ArgReader, input: ArgValue[]): ArgResult { return reader(...input); }
const identity = { mark: 23 };
const rows: { input: ArgValue[]; count: number; head: ArgValue; tail: ArgValue[] }[] = [
  { input: [], count: 0, head: undefined, tail: [] }, { input: [null], count: 1, head: null, tail: [] },
  { input: [-0, NaN, undefined, identity], count: 4, head: -0, tail: [NaN, undefined, identity] }
];
for (const reader of readers) for (const row of rows) {
  const actual = invoke(reader, row.input);
  assert.sameValue(actual.raw.count, row.count); assert.compareArray(actual.raw.values, row.input); assert.sameValue(actual.head, row.head);
  assert.compareArray(actual.tail, row.tail); assert.compareArray(actual.grown, [...row.tail, "rest-only"]); assert.sameValue(Array.isArray(actual.grown), true);
}
