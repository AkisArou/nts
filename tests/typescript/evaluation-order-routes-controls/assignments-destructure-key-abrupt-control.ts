/*---
description: "Control for assignments-destructure-key-abrupt; A throwing second member key closes the iterator after the first assignment without taking another step."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-class, ts-class-fields, ts-accessors, ts-this, ts-closures, ts-literal-types, ts-symbols, ts-computed-keys, ts-errors, ts-unknown, ts-unions, ts-null-undefined, ts-instanceof]
---*/
// A typed iterator carries member assignment with a checked key helper; node retains the first write, closes after a key RangeError, and never advances or writes the second member. The control saves each step in order.
const log: string[] = [];
class Cell {
  id: string; rawA: number = -1; rawB: number = -2;
  constructor(id: string) { log.push(`new:${id}`); this.id = id; }
  get a(): number { log.push(`get:${this.id}:a`); return this.rawA; }
  set a(value: number) { log.push(`set:${this.id}:a:${value}`); this.rawA = value; }
  get b(): number { log.push(`get:${this.id}:b`); return this.rawB; }
  set b(value: number) { log.push(`set:${this.id}:b:${value}`); this.rawB = value; }
}
interface Cursor { next(): IteratorYieldResult<number>; return(): IteratorReturnResult<undefined>; }
interface Source { [Symbol.iterator](): Cursor; }
for (const fail of [false, true]) for (const initial of [-2, 5]) {
  const first = new Cell("first"), second = new Cell("second"), failure = new RangeError("key"); let active: Cell = first; let steps = 0, closed = false;
  function advance(): IteratorYieldResult<number> { const step = ++steps; log.push(`next:${step}`); active = second;
    return { get done(): false { log.push(`done:${step}`); return false; }, get value(): number { log.push(`value:${step}`); return initial + step - 1; } }; }
  const cursor: Cursor = { get next() { log.push("next-method"); return advance; }, return() { log.push("return"); closed = true; return { done: true, value: undefined }; } };
  const values: Source = { [Symbol.iterator]() { log.push("iterator"); return cursor; } };
  function source(): Source { log.push("source"); return values; }
  function target(): Cell { log.push(`target:${active.id}`); return active; }
  function key(): "b" { log.push("key"); if (fail) throw failure; return "b"; }
  function run(): Source { log.push("run"); const values = source();
    const acquire = values[Symbol.iterator];
    const cursor = acquire.call(values);
    const advance = cursor.next;
    try {
      const first = target();
      const one = advance.call(cursor);
      const oneDone = one.done;
      const oneValue = one.value;
      first.a = oneValue;
      const second = target();
      const propertyKey = key();
      const two = advance.call(cursor);
      const twoDone = two.done;
      const twoValue = two.value;
      second[propertyKey] = twoValue;
      return values;
    } finally {
      const close = cursor.return;
      close.call(cursor);
    } }
  log.length = 0; let caught: unknown; let result: Source | undefined; try { result = run(); } catch (error) { log.push("caught"); caught = error; }
  const expected = ["run", "source", "iterator", "next-method", "target:first", "next:1", "done:1", "value:1", `set:first:a:${initial}`, "target:second", "key"];
  if (!fail) expected.push("next:2", "done:2", "value:2", `set:second:b:${initial + 1}`); expected.push("return"); if (fail) expected.push("caught");
  assert.compareArray(log, expected);
  assert.sameValue(caught, fail ? failure : undefined); assert.sameValue(caught instanceof RangeError, fail); assert.sameValue(result, fail ? undefined : values);
  assert.sameValue(first.rawA, initial); assert.sameValue(first.rawB, -2); assert.sameValue(second.rawA, -1); assert.sameValue(second.rawB, fail ? -2 : initial + 1);
  assert.sameValue(steps, fail ? 1 : 2); assert.sameValue(closed, true); assert.sameValue(active, second);
}
