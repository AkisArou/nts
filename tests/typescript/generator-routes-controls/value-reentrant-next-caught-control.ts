/*---
description: Explicit state iterator control for A generator reached again through its typed holder rejects reentrant next with TypeError and continues after the rejection is caught.
features: [ts-generator-route-values, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-interfaces, ts-errors, ts-unknown, ts-symbols]
---*/
// Numeric iterator states replace suspension; A holder points back to the executing generator; node rejects recursive next at each suspension transition without losing later yields or completion.
type V = number | string | null | undefined | { mark: number };
type Cursor = IterableIterator<V, V, undefined>;
function check(step: IteratorResult<V, V>, value: V, done: boolean): void { assert.sameValue(step.value, value); assert.sameValue(step.done, done); }
function fresh(step: IteratorResult<V, V>, seen: IteratorResult<V, V>[]): void { for (const previous of seen) assert.sameValue(step === previous, false); seen.push(step); }
interface Slot { cursor: Cursor | undefined; }
function attempt(slot: Slot, errors: unknown[], log: unknown[]): void {
  const own = slot.cursor; if (own === undefined) throw new Error("missing cursor"); let caught: unknown;
  assert.throws(TypeError, () => { try { own.next(); } catch (error) { caught = error; throw error; } });
  assert.sameValue(caught instanceof TypeError, true); errors.push(caught); log.push("caught");
}
function manual(values: V[], finish: V, log: unknown[], slot: Slot, errors: unknown[]): Cursor {
  let state = 0, index = 0;
  return { [Symbol.iterator](): Cursor { return this; },
    next(): IteratorResult<V, V> {
      if (state === -1) throw new TypeError("running"); if (state === 2) return { value: undefined, done: true };
      const first = state === 0; state = -1;
      try { if (first) log.push("begin"); attempt(slot, errors, log);
        if (index < values.length) { const value = values[index++]; log.push("yield", value); state = 1; return { value, done: false }; }
        state = 2; log.push("end"); return { value: finish, done: true };
      } catch (error) { state = 2; throw error; }
    },
    return(value?: V): IteratorResult<V, V> { state = 2; return { value, done: true }; }, throw(error?: unknown): IteratorResult<V, V> { state = 2; throw error; }
  };
}
function declared(values: V[], finish: V, log: unknown[], slot: Slot, errors: unknown[]): Cursor { return manual(values, finish, log, slot, errors); }
const expression = function (values: V[], finish: V, log: unknown[], slot: Slot, errors: unknown[]): Cursor { return manual(values, finish, log, slot, errors); };
const makers: ((values: V[], finish: V, log: unknown[], slot: Slot, errors: unknown[]) => Cursor)[] = [declared, expression];
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of makers) for (const values of rows) {
  const log: unknown[] = [], errors: unknown[] = [], seen: IteratorResult<V, V>[] = [], slot: Slot = { cursor: undefined }, cursor = make(values, finish, log, slot, errors); slot.cursor = cursor;
  const out: V[] = []; let step = cursor.next(); fresh(step, seen); while (!step.done) { assert.sameValue(step.done, false); out.push(step.value); step = cursor.next(); fresh(step, seen); }
  assert.compareArray(out, values); check(step, finish, true); assert.sameValue(errors.length, values.length + 1);
  const end = cursor.next(), again = cursor.next(); fresh(end, seen); fresh(again, seen); check(end, undefined, true); check(again, undefined, true); assert.sameValue(end === again, false);
  const expected: unknown[] = ["begin", "caught"]; for (const value of values) expected.push("yield", value, "caught"); expected.push("end"); assert.compareArray(log, expected);
}
