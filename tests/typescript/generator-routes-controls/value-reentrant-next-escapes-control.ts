/*---
description: Explicit state iterator control for An escaping reentrant next TypeError runs generator cleanup once and permanently completes the typed holder cursor.
features: [ts-generator-route-values, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-interfaces, ts-errors, ts-unknown, ts-symbols]
---*/
// Numeric iterator states replace suspension; A helper reaches the currently running generator through a holder; node propagates TypeError, runs finally and answers only completed results afterward.
type V = number | string | null | undefined | { mark: number };
type Cursor = IterableIterator<V, V, undefined>;
function check(step: IteratorResult<V, V>, value: V, done: boolean): void { assert.sameValue(step.value, value); assert.sameValue(step.done, done); }
function fresh(step: IteratorResult<V, V>, seen: IteratorResult<V, V>[]): void { for (const previous of seen) assert.sameValue(step === previous, false); seen.push(step); }
interface Slot { cursor: Cursor | undefined; }
function reenter(slot: Slot): void { const own = slot.cursor; if (own === undefined) throw new Error("missing cursor"); own.next(); }
function manual(values: V[], finish: V, log: unknown[], slot: Slot, fail: boolean): Cursor {
  let state = 0, index = 0;
  return { [Symbol.iterator](): Cursor { return this; },
    next(): IteratorResult<V, V> {
      if (state === -1) throw new TypeError("running"); if (state === 2) return { value: undefined, done: true };
      const first = state === 0; state = -1;
      try { if (first) { log.push("begin"); if (fail) reenter(slot); }
        if (index < values.length) { const value = values[index++]; log.push("yield", value); state = 1; return { value, done: false }; }
        state = 2; log.push("end", "finally"); return { value: finish, done: true };
      } catch (error) { state = 2; log.push("finally"); throw error; }
    },
    return(value?: V): IteratorResult<V, V> { if (state === 1) log.push("finally"); state = 2; return { value, done: true }; },
    throw(error?: unknown): IteratorResult<V, V> { if (state === 1) log.push("finally"); state = 2; throw error; }
  };
}
function declared(values: V[], finish: V, log: unknown[], slot: Slot, fail: boolean): Cursor { return manual(values, finish, log, slot, fail); }
const expression = function (values: V[], finish: V, log: unknown[], slot: Slot, fail: boolean): Cursor { return manual(values, finish, log, slot, fail); };
const makers: ((values: V[], finish: V, log: unknown[], slot: Slot, fail: boolean) => Cursor)[] = [declared, expression];
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of makers) for (const values of rows) for (const fail of [false, true]) {
  const log: unknown[] = [], seen: IteratorResult<V, V>[] = [], slot: Slot = { cursor: undefined }, cursor = make(values, finish, log, slot, fail); slot.cursor = cursor; let caught: unknown;
  const run = (): void => { try { const out: V[] = []; let step = cursor.next(); fresh(step, seen); while (!step.done) { assert.sameValue(step.done, false); out.push(step.value); step = cursor.next(); fresh(step, seen); } assert.compareArray(out, values); check(step, finish, true); } catch (error) { caught = error; throw error; } };
  if (fail) { assert.throws(TypeError, run); assert.sameValue(caught instanceof TypeError, true); } else { run(); assert.sameValue(caught, undefined); }
  const end = cursor.next(), again = cursor.next(); fresh(end, seen); fresh(again, seen); check(end, undefined, true); check(again, undefined, true); assert.sameValue(end === again, false);
  const expected: unknown[] = ["begin"]; if (!fail) { for (const value of values) expected.push("yield", value); expected.push("end"); } expected.push("finally"); assert.compareArray(log, expected);
}
