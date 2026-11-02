/*---
description: An array of generator cursors keeps empty, one-yield and several-yield activations independent under interleaved next calls.
features: [ts-generator-route-values, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-objects, ts-symbols, ts-errors]
---*/
// A declared cursor array carries three independent generators; node keeps each position, one-time return and fresh completed results separate.
type V = number | string | null | undefined | { mark: number };
type Cursor = IterableIterator<V, V, undefined>;
function check(step: IteratorResult<V, V>, value: V, done: boolean): void { assert.sameValue(step.value, value); assert.sameValue(step.done, done); }
function record(step: IteratorResult<V, V>, seen: IteratorResult<V, V>[], out: unknown[]): void { for (const previous of seen) assert.sameValue(step === previous, false); seen.push(step); out.push(step.value, step.done); }
type Maker = (values: V[], finish: V, log: unknown[]) => Cursor;
function* declared(values: V[], finish: V, log: unknown[]): Cursor {
  try { for (const value of values) { log.push("yield", value); yield value; log.push("resume", value); } log.push("body:return"); return finish; } finally { log.push("finally"); }
}
const expression = function* (values: V[], finish: V, log: unknown[]): Cursor {
  try { for (const value of values) { log.push("yield", value); yield value; log.push("resume", value); } log.push("body:return"); return finish; } finally { log.push("finally"); }
};
const makers: Maker[] = [declared, expression];
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of makers) for (const values of rows) {
  const plans: { items: V[]; end: V }[] = [{ items: [], end: finish }, { items: values.slice(0, 1), end: identity }, { items: values, end: "third" }];
  const logs: unknown[][] = [[], [], []], outputs: unknown[][] = [[], [], []], cursors: Cursor[] = [make(plans[0].items, plans[0].end, logs[0]), make(plans[1].items, plans[1].end, logs[1]), make(plans[2].items, plans[2].end, logs[2])];
  const seen: IteratorResult<V, V>[] = []; for (let round = 0; round < values.length + 3; round++) for (const slot of [2, 0, 1]) record(cursors[slot].next(), seen, outputs[slot]);
  for (let slot = 0; slot < 3; slot++) { const plan = plans[slot], expected: unknown[] = [], expectedLog: unknown[] = [];
    for (const value of plan.items) { expected.push(value, false); expectedLog.push("yield", value, "resume", value); } expected.push(plan.end, true);
    for (let round = plan.items.length + 1; round < values.length + 3; round++) expected.push(undefined, true); expectedLog.push("body:return", "finally");
    assert.compareArray(outputs[slot], expected); assert.compareArray(logs[slot], expectedLog);
  }
}
