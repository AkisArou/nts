/*---
description: Explicit state control for A tuple-selected generator forwards throw through two levels, yields recovery and preserves the next send before ordered cleanup.
features: [ts-generator-route-delegation, ts-generators, ts-iteration, ts-arrays, ts-unions, ts-symbols, ts-tuples, ts-errors, ts-function-types]
---*/
// Explicit iterator control: A generator tuple carries two delegation levels; node raises the original object at the inner pause, yields recovery and sends the later value to that recovery yield.
type Value = number | string | undefined | null | { id: number };
interface Cursor extends IterableIterator<Value, Value, Value> { return(value: Value): IteratorResult<Value, Value>; throw(error: unknown): IteratorResult<Value, Value>; }
function check(result: IteratorResult<Value, Value>, value: Value, done: boolean, seen: IteratorResult<Value, Value>[]): void {
  assert.sameValue(result.value, value); assert.sameValue(result.done, done); assert.compareArray(Object.keys(result), ["value", "done"]);
  for (const prior of seen) assert.sameValue(result === prior, false); seen.push(result);
}
function inner(value: Value, log: unknown[]): Cursor { let state = 0; return { [Symbol.iterator](): Cursor { return this; },
  next(sent?: Value): IteratorResult<Value, Value> { if (state === 3) return { value: undefined, done: true }; if (state === 0) { state = 1; return { value, done: false }; } const recovered = state === 2; state = 3; if (recovered) log.push("sent", sent); log.push("inner"); return { value: recovered ? sent : "natural", done: true }; },
  return(result: Value): IteratorResult<Value, Value> { if (state === 1 || state === 2) log.push("inner"); state = 3; return { value: result, done: true }; },
  throw(error: unknown): IteratorResult<Value, Value> { if (state === 1) { state = 2; log.push("caught", error); return { value: "recovered", done: false }; } if (state === 2) log.push("inner"); state = 3; throw error; }
}; }
function relay(source: Cursor, label: string, log: unknown[]): Cursor {
  let state = 0;
  function finish(result: IteratorResult<Value, Value>): IteratorResult<Value, Value> { if (result.done) { state = 2; log.push(label); } return { value: result.value, done: result.done === true }; }
  return { [Symbol.iterator](): Cursor { return this; },
    next(value?: Value): IteratorResult<Value, Value> { if (state === 2) return { value: undefined, done: true }; const first = state === 0; state = 1; try { return finish(source.next(first ? undefined : value)); } catch (error) { state = 2; log.push(label); throw error; } },
    return(value: Value): IteratorResult<Value, Value> { if (state !== 1) { state = 2; return { value, done: true }; } try { return finish(source.return(value)); } catch (error) { state = 2; log.push(label); throw error; } },
    throw(error: unknown): IteratorResult<Value, Value> { if (state !== 1) { state = 2; throw error; } try { return finish(source.throw(error)); } catch (failure) { state = 2; log.push(label); throw failure; } }
  };
}
function middle(source: Cursor, log: unknown[]): Cursor { return relay(source, "middle", log); }
function declared(source: Cursor, log: unknown[]): Cursor { return relay(middle(source, log), "outer", log); }
const expression = function (source: Cursor, log: unknown[]): Cursor { return relay(middle(source, log), "outer", log); };
const factories: ((source: Cursor, log: unknown[]) => Cursor)[] = [declared, expression], identity = { id: 83 };
for (const make of factories) for (const value of [-0, NaN, undefined, identity]) {
  const log: unknown[] = [], decoyLog: unknown[] = [], seen: IteratorResult<Value, Value>[] = [], failure = new RangeError("injected");
  const slots: [Cursor, Cursor] = [make(inner("decoy", decoyLog), decoyLog), make(inner(value, log), log)], iterator = slots[1];
  check(iterator.next("ignored"), value, false, seen); check(iterator.throw(failure), "recovered", false, seen); assert.compareArray(log, ["caught", failure]); assert.compareArray(decoyLog, []);
  check(iterator.next(value), value, true, seen); check(iterator.next(identity), undefined, true, seen); check(iterator.next(undefined), undefined, true, seen);
  assert.compareArray(log, ["caught", failure, "sent", value, "inner", "middle", "outer"]); check(slots[0].next(), "decoy", false, seen); check(slots[0].return(undefined), undefined, true, seen); assert.compareArray(decoyLog, ["inner", "middle", "outer"]);
}
