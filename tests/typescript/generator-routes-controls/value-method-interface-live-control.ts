/*---
description: Explicit state iterator control for Class and literal generator methods reached through an interface retain their receiver and read updated fields when resuming.
features: [ts-generator-route-values, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-class, ts-class-fields, ts-interfaces, ts-this, ts-symbols, ts-spread]
---*/
// Numeric iterator states replace suspension; An interface method returns a cursor bound to its owner; node reads live fields after suspension but never revives an already-completed generator.
type V = number | string | null | undefined | { mark: number };
type Cursor = IterableIterator<V, V, undefined>;
function check(step: IteratorResult<V, V>, value: V, done: boolean): void { assert.sameValue(step.value, value); assert.sameValue(step.done, done); }
function fresh(step: IteratorResult<V, V>, seen: IteratorResult<V, V>[]): void { for (const previous of seen) assert.sameValue(step === previous, false); seen.push(step); }
interface Owner { items: V[]; terminal: V; read(log: unknown[]): Cursor; }
function manual(owner: Owner, log: unknown[]): Cursor {
  let state = 0, index = 0;
  return { [Symbol.iterator](): Cursor { return this; },
    next(): IteratorResult<V, V> { if (state === 2) return { value: undefined, done: true }; if (state === 0) log.push("enter", owner);
      if (index < owner.items.length) { state = 1; const value = owner.items[index++]; log.push("yield", value); return { value, done: false }; }
      state = 2; log.push("finish", owner.terminal); return { value: owner.terminal, done: true }; },
    return(value?: V): IteratorResult<V, V> { state = 2; return { value, done: true }; }, throw(error?: unknown): IteratorResult<V, V> { state = 2; throw error; }
  };
}
class ClassOwner implements Owner {
  items: V[]; terminal: V;
  constructor(items: V[], terminal: V) { this.items = items; this.terminal = terminal; }
  read(log: unknown[]): Cursor { return manual(this, log); }
}
function literal(items: V[], terminal: V): Owner { return { items, terminal, read(log: unknown[]): Cursor { return manual(this, log); } }; }
const factories: ((items: V[], terminal: V) => Owner)[] = [(items, terminal) => new ClassOwner(items, terminal), literal];
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of factories) for (const values of rows) {
  const log: unknown[] = [], seen: IteratorResult<V, V>[] = [], owner = make(values.slice(), finish), cursor: Cursor = owner.read(log); assert.compareArray(log, []);
  const first = cursor.next(); fresh(first, seen); check(first, values.length === 0 ? finish : values[0], values.length === 0);
  owner.terminal = identity; owner.items.push("later"); assert.sameValue(owner.terminal, identity); assert.compareArray(owner.items, [...values, "later"]);
  const out: V[] = []; let step = cursor.next(); fresh(step, seen); while (!step.done) { assert.sameValue(step.done, false); out.push(step.value); step = cursor.next(); fresh(step, seen); }
  assert.compareArray(out, values.length === 0 ? [] : [...values.slice(1), "later"]); check(step, values.length === 0 ? undefined : identity, true);
  const end = cursor.next(), again = cursor.next(); fresh(end, seen); fresh(again, seen); check(end, undefined, true); check(again, undefined, true); assert.sameValue(end === again, false);
  const expected: unknown[] = ["enter", owner]; for (const value of values) expected.push("yield", value);
  if (values.length > 0) expected.push("yield", "later"); expected.push("finish", values.length === 0 ? finish : identity); assert.compareArray(log, expected);
}
