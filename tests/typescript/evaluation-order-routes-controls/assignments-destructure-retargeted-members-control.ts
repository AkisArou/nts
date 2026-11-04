/*---
description: "Control for assignments-destructure-retargeted-members; Destructuring member targets interleave receiver and key selection with iterator steps and transforming setters."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-class, ts-class-fields, ts-accessors, ts-this, ts-closures, ts-literal-types, ts-unions, ts-symbols, ts-computed-keys, ts-typeof-operator]
---*/
// A typed yielding iterator carries member assignment; node selects each target before its step, keeps the key chosen before that step mutates it, then closes the iterator. The control saves each step in order.
const log: string[] = [];
let selectedKey: "a" | "b" = "a";
class Cell {
  id: string; rawA: number = -1; rawB: number = -2;
  constructor(id: string) { log.push(`new:${id}`); this.id = id; }
  get a(): number { log.push(`get:${this.id}:a`); return this.rawA; }
  set a(value: number) { log.push(`set:${this.id}:a:${value}`); this.rawA = value + 10; selectedKey = "b"; }
  get b(): number { log.push(`get:${this.id}:b`); return this.rawB; }
  set b(value: number) { log.push(`set:${this.id}:b:${value}`); this.rawB = -value; }
}
interface Cursor { next(): IteratorYieldResult<number>; return(): IteratorReturnResult<undefined>; }
interface Source { [Symbol.iterator](): Cursor; }
for (const initial of [-2, 0, 8]) {
  const first = new Cell("first"), second = new Cell("second"); let active: Cell = first; let steps = 0, closed = false; selectedKey = "a";
  function advance(): IteratorYieldResult<number> { const step = ++steps; log.push(`next:${step}`); active = step === 1 ? second : first; if (step === 2) selectedKey = "a";
    return { get done(): false { log.push(`done:${step}`); return false; }, get value(): number { log.push(`value:${step}`); return initial + step - 1; } }; }
  const cursor: Cursor = { get next() { log.push("next-method"); return advance; }, return() { log.push("return"); closed = true; return { done: true, value: undefined }; } };
  const values: Source = { [Symbol.iterator]() { log.push("iterator"); return cursor; } };
  function source(): Source { log.push("source"); return values; }
  function target(): Cell { log.push(`target:${active.id}`); return active; }
  function key(): "a" | "b" { log.push(`key:${selectedKey}`); return selectedKey; }
  function run(): Source { log.push("run"); const values = source();
    const acquire = values[Symbol.iterator];
    const cursor = acquire.call(values);
    const advance = cursor.next;
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
    const close = cursor.return;
    close.call(cursor);
    return values; }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", "source", "iterator", "next-method", "target:first", "next:1", "done:1", "value:1", `set:first:a:${initial}`, "target:second", "key:b", "next:2", "done:2", "value:2", `set:second:b:${initial + 1}`, "return"]);
  assert.sameValue(result, values); assert.sameValue(typeof result, "object"); assert.sameValue(steps, 2); assert.sameValue(closed, true);
  assert.sameValue(first.rawA, initial + 10); assert.sameValue(first.rawB, -2); assert.sameValue(second.rawA, -1); assert.sameValue(second.rawB, -(initial + 1));
  assert.sameValue(active, first); assert.sameValue(selectedKey, "a");
}
