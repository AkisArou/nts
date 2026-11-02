/*---
description: Static generator methods through a declared method interface defer body reads until first next and retain the actual static receiver.
features: [ts-generator-route-values, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-class, ts-static, ts-interfaces, ts-this, ts-symbols]
---*/
// An interface array carries two class objects; node creates lazy generator cursors whose first next reads the current static fields from the selected receiver.
type V = number | string | null | undefined | { mark: number };
type Cursor = IterableIterator<V, V, undefined>;
function check(step: IteratorResult<V, V>, value: V, done: boolean): void { assert.sameValue(step.value, value); assert.sameValue(step.done, done); }
function fresh(step: IteratorResult<V, V>, seen: IteratorResult<V, V>[]): void { for (const previous of seen) assert.sameValue(step === previous, false); seen.push(step); }
interface Owner { items: V[]; terminal: V; read(log: unknown[]): Cursor; }
class First {
  static items: V[] = []; static terminal: V = undefined;
  static *read(log: unknown[]): Cursor { log.push("enter", this); for (let index = 0; index < this.items.length; index++) { const value = this.items[index]; log.push("yield", value); yield value; } log.push("finish", this.terminal); return this.terminal; }
}
class Second {
  static items: V[] = []; static terminal: V = undefined;
  static *read(log: unknown[]): Cursor { log.push("enter", this); for (let index = 0; index < this.items.length; index++) { const value = this.items[index]; log.push("yield", value); yield value; } log.push("finish", this.terminal); return this.terminal; }
}
const owners: Owner[] = [First, Second];
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const owner of owners) for (const values of rows) {
  const log: unknown[] = [], seen: IteratorResult<V, V>[] = []; owner.items = values.slice(); owner.terminal = finish; const cursor: Cursor = owner.read(log); assert.compareArray(log, []);
  owner.items = values.slice().reverse(); owner.terminal = identity; assert.compareArray(owner.items, values.slice().reverse()); assert.sameValue(owner.terminal, identity);
  const out: V[] = []; let step = cursor.next(); fresh(step, seen); while (!step.done) { assert.sameValue(step.done, false); out.push(step.value); step = cursor.next(); fresh(step, seen); }
  assert.compareArray(out, values.slice().reverse()); check(step, identity, true);
  const end = cursor.next(), again = cursor.next(); fresh(end, seen); fresh(again, seen); check(end, undefined, true); check(again, undefined, true); assert.sameValue(end === again, false);
  const expected: unknown[] = ["enter", owner]; for (const value of values.slice().reverse()) expected.push("yield", value); expected.push("finish", identity); assert.compareArray(log, expected);
}
