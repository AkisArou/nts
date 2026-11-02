/*---
description: Explicit state control for A method-returned generator forwards return through two levels and runs inner, middle and outer cleanup once in order.
features: [ts-generator-route-delegation, ts-generators, ts-iteration, ts-arrays, ts-unions, ts-symbols, ts-class, ts-interfaces, ts-errors, ts-function-types]
---*/
// Explicit iterator control: A method return carries a twice-delegating generator; node preserves an early return payload and unwinds inner-to-outer, including empty and already-finished states.
type Value = number | string | undefined | null | { id: number };
interface Cursor extends IterableIterator<Value, Value, Value> { return(value: Value): IteratorResult<Value, Value>; throw(error: unknown): IteratorResult<Value, Value>; }
function check(result: IteratorResult<Value, Value>, value: Value, done: boolean, seen: IteratorResult<Value, Value>[]): void {
  assert.sameValue(result.value, value); assert.sameValue(result.done, done); assert.compareArray(Object.keys(result), ["value", "done"]);
  for (const prior of seen) assert.sameValue(result === prior, false); seen.push(result);
}
function inner(values: Value[], log: unknown[]): Cursor { let state = 0, index = 0; return { [Symbol.iterator](): Cursor { return this; },
  next(): IteratorResult<Value, Value> { if (state === 2) return { value: undefined, done: true }; state = 1; if (index < values.length) return { value: values[index++], done: false }; state = 2; log.push("inner"); return { value: "natural", done: true }; },
  return(value: Value): IteratorResult<Value, Value> { if (state === 1) log.push("inner"); state = 2; return { value, done: true }; }, throw(error: unknown): IteratorResult<Value, Value> { if (state === 1) log.push("inner"); state = 2; throw error; }
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
class Factory { make(source: Cursor, log: unknown[]): Cursor { return relay(middle(source, log), "outer", log); } }
const literal = { make(source: Cursor, log: unknown[]): Cursor { return relay(middle(source, log), "outer", log); } };
interface Maker { make(source: Cursor, log: unknown[]): Cursor; }
const factories: Maker[] = [new Factory(), literal], identity = { id: 61 }, rows: Value[][] = [[], [-0], [NaN, undefined, identity]];
for (const factory of factories) for (const values of rows) for (const result of [undefined, -0, NaN, identity]) {
  const log: unknown[] = [], seen: IteratorResult<Value, Value>[] = [], decoyLog: unknown[] = [], decoy = inner(["decoy"], decoyLog), iterator = factory.make(inner(values, log), log);
  check(iterator.next("ignored"), values.length === 0 ? "natural" : values[0], values.length === 0, seen);
  check(iterator.return(result), result, true, seen); assert.compareArray(log, ["inner", "middle", "outer"]); assert.compareArray(decoyLog, []);
  check(iterator.return(identity), identity, true, seen); check(iterator.next(result), undefined, true, seen); check(iterator.next(undefined), undefined, true, seen);
  const failure = new RangeError("finished"); let caught: unknown = undefined; try { iterator.throw(failure); } catch (error) { caught = error; }
  assert.sameValue(caught, failure); assert.compareArray(log, ["inner", "middle", "outer"]); check(decoy.next(), "decoy", false, seen); check(decoy.return(undefined), undefined, true, seen); assert.compareArray(decoyLog, ["inner"]);
}
