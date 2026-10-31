/*---
description: Destructuring a constrained iterable orders iterator acquisition, next, its getter and early return.
features: [ts-implicit-order, ts-accessors, ts-iteration, ts-destructuring, ts-class, ts-class-fields, ts-interfaces, ts-generics, ts-generic-constraints, ts-symbols]
---*/
// Route: generic array destructuring whose next reads a class getter before iterator closing; node preserves the complete hook order and state.
interface Readable { readonly value: number; readValue(): number; }
interface Cursor { next(): IteratorResult<number, undefined>; return(): IteratorResult<number, undefined>; }
interface Source { [Symbol.iterator](): Cursor; }
const log: string[] = [];
let state = 0;
class Cell implements Readable {
  stored: number;
  constructor(value: number) { this.stored = value; }
  readValue(): number { state += 100; log.push(`get:${this.stored}:${state}`); return this.stored; }
  get value(): number { return this.readValue(); }
}
class Sequence implements Source {
  count: number; cell: Readable;
  constructor(count: number) { this.count = count; this.cell = new Cell(count + 10); }
  [Symbol.iterator](): Cursor {
    state++; log.push(`iterator:${this.count}:${arguments.length}:${state}`);
    const count = this.count, cell = this.cell; let index = 0;
    return {
      next(): IteratorResult<number, undefined> {
        state += 10; log.push(`next:${index}:${arguments.length}:${state}`);
        return index++ < count ? { done: false, value: cell.value } : { done: true, value: undefined };
      },
      return(): IteratorResult<number, undefined> {
        state += 1000; log.push(`return:${index}:${arguments.length}:${state}`);
        return { done: true, value: undefined };
      }
    };
  }
}
function consume<T extends Source>(source: T): number[] { const [head = -1] = source; return [head]; }
for (const count of [0, 1, 3]) {
  log.length = 0; state = 0;
  const result = consume(new Sequence(count));
  assert.compareArray(result, [count === 0 ? -1 : count + 10]);
  assert.sameValue(state, count === 0 ? 11 : 1111);
  const expected = [`iterator:${count}:0:1`, "next:0:0:11"];
  if (count > 0) expected.push(`get:${count + 10}:111`, "return:1:0:1111");
  assert.compareArray(log, expected);
}
