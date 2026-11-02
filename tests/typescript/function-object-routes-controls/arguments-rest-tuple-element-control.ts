/*---
description: Explicit incoming-list control for functions selected from a typed tuple retain all incoming arguments independently of their rest arrays.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-tuples, ts-rest-parameters, ts-optional-parameters]
---*/
// Tuple-selected functions receive explicit lists; fixed and trailing slots are split before a private tail grows.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

function takeIncoming(incoming: ArgValue[]): ArgSnapshot {
  const values: unknown[] = []; let count = 0;
  for (const value of incoming) { values.push(value); count++; }
  return { count, values };
}

interface ArgResult { raw: ArgSnapshot; head: ArgValue; tail: ArgValue[]; grown: ArgValue[]; }
type ArgReader = (incoming: ArgValue[]) => ArgResult;
function tailOf(incoming: ArgValue[]): ArgValue[] { const tail: ArgValue[] = []; let index = 0; for (const value of incoming) { if (index > 0) tail.push(value); index++; } return tail; }
function declared(incoming: ArgValue[]): ArgResult { const head = incoming[0], tail = tailOf(incoming), before = tail.slice(); tail.push("rest-only"); return { raw: takeIncoming(incoming), head, tail: before, grown: tail }; }
const expression = function (incoming: ArgValue[]): ArgResult { const head = incoming[0], tail = tailOf(incoming), before = tail.slice(); tail.push("rest-only"); return { raw: takeIncoming(incoming), head, tail: before, grown: tail }; };
const readers: [ArgReader, ArgReader] = [declared, expression];
function invoke(reader: ArgReader, input: ArgValue[]): ArgResult { return reader(input); }
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
