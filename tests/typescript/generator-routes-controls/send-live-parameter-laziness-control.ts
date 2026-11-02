/*---
description: An Iterator parameter reads a live typed cell only when next runs, including writes before first entry and between suspended yields.
features: [ts-generator-route-sending-completion, ts-generators, ts-iteration, ts-arrays, ts-interfaces, ts-function-types, ts-unions, ts-null-undefined, ts-objects]
---*/
// Explicit state-number control; A typed Iterator parameter carries a generator over a live cell; node delays entry, reads each later write at resumption and never re-enters after completion.
type Value = number | string | undefined | { id: number };
interface Cell { current: Value; finish: Value; }
type Step = IteratorResult<Value, Value>;
interface Cursor extends IterableIterator<Value, Value, Value> { return(value?: Value): Step; throw(error?: unknown): Step; }
type Factory = (cell: Cell, count: number, log: unknown[]) => Cursor;
function check(step: { value: unknown; done?: boolean }, value: unknown, done: boolean, seen: object[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
function model(cell: Cell, count: number, log: unknown[]): Cursor {
  let state = 0, index = 0;
  return { [Symbol.iterator](): Cursor { return this; },
    next(sent?: Value): Step { if (state === 2) return { value: undefined, done: true }; if (state === 0) { state = 1; log.push("enter", cell.current); } else log.push("sent", sent, "read", cell.current); if (index++ < count) { const value = cell.current; log.push("yield", value); return { value, done: false }; } state = 2; log.push("return", cell.finish); return { value: cell.finish, done: true }; },
    return(value?: Value): Step { state = 2; return { value, done: true }; }, throw(error?: unknown): Step { state = 2; throw error; } };
}
function declared(cell: Cell, count: number, log: unknown[]): Cursor { return model(cell, count, log); }
const expression = function (cell: Cell, count: number, log: unknown[]): Cursor { return model(cell, count, log); };
const makers: Factory[] = [declared, expression];
function advance(cursor: Iterator<Value, Value, Value>, sent: Value): Step { return cursor.next(sent); }
const identity = { id: 61 }, completion = { id: 107 }, inputs: Value[] = [-0, NaN, undefined, identity], updates: Value[] = [identity, NaN, undefined], sends: Value[] = ["first send", -0, identity];
for (const make of makers) for (const count of [0, 1, 3]) for (const input of inputs) {
  const log: unknown[] = [], seen: object[] = [], cell: Cell = { current: "creation", finish: "old" }, cursor = make(cell, count, log);
  assert.compareArray(log, []); cell.current = input; cell.finish = completion; assert.sameValue(cell.current, input); assert.sameValue(cell.finish, completion);
  let step = advance(cursor, "ignored"); const expected: unknown[] = ["enter", input];
  for (let i = 0; i < count; i++) {
    const value = i === 0 ? input : updates[i - 1]; check(step, value, false, seen); cell.current = updates[i]; assert.sameValue(cell.current, updates[i]);
    step = advance(cursor, sends[i]); expected.push("yield", value, "sent", sends[i], "read", updates[i]);
  }
  check(step, completion, true, seen); cell.current = "after"; cell.finish = "after"; assert.sameValue(cell.current, "after"); assert.sameValue(cell.finish, "after");
  check(advance(cursor, identity), undefined, true, seen); expected.push("return", completion); assert.compareArray(log, expected);
}
