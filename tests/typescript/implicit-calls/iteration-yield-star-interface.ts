/*---
description: Yield delegation through an interface iterable forwards next arguments and retains the final iterator return value.
features: [ts-implicit-iteration, ts-iteration, ts-interfaces, ts-symbols, ts-objects, ts-arrays, ts-generators]
---*/
// Implicit calls: yield* through an interface parameter; node forwards undefined then seven, and returns the delegated completion value.
const log: string[] = [];
let state = 0, expectedSource: object = {};
interface Cursor { next(sent?: number): IteratorResult<number, number>; return(sent?: number): IteratorResult<number, number>; }
interface Source { [Symbol.iterator](): Cursor; }
function open(owner: object, count: number, base: number, argc: number): Cursor {
  assert.sameValue(owner, expectedSource); state++; log.push(`iterator:${base}:${count}:${argc}:${state}`);
  let index = 0;
  const cursor: Cursor = {
    next(sent?: number): IteratorResult<number, number> {
      assert.sameValue(this, cursor); state += 10 + (sent ?? 0);
      log.push(`next:${index}:${arguments.length}:${String(sent)}:${state}`);
      return index < count ? { done: false, value: base + index++ } : { done: true, value: 100 + count };
    },
    return(sent?: number): IteratorResult<number, number> {
      assert.sameValue(this, cursor); state += 100; log.push(`return:${index}:${arguments.length}:${String(sent)}:${state}`);
      return { done: true, value: sent ?? -1 };
    }
  }; return cursor;
}
interface First extends Source { first: number; count: number; }
interface Second extends Source { second: number; count: number; }
function first(count: number): First { return { first: 10, count, [Symbol.iterator]() { return open(this, this.count, this.first, arguments.length); } }; }
function second(count: number): Second { return { second: 20, count, [Symbol.iterator]() { return open(this, this.count, this.second, arguments.length); } }; }
function* consume(source: Source): Generator<number, number | undefined, number | undefined> {
  return yield* source;
}
for (const count of [0, 1, 3]) for (const source of [first(count), second(count)]) {
  log.length = 0; state = 0; expectedSource = source;
  const base = "first" in source ? source.first : source.second;
  const out: number[] = [], generator = consume(source); let step = generator.next();
  while (!step.done) { out.push(step.value); step = generator.next(7); }
  assert.sameValue(step.value, 100 + count);
  const values: number[] = []; for (let i = 0; i < count; i++) values.push(base + i);
  assert.compareArray(out, values);
  const pulls = count + 1;
  const expected = [`iterator:${base}:${count}:0:1`];
  for (let i = 0; i < pulls; i++) expected.push(`next:${i}:1:${i === 0 ? "undefined" : "7"}:${1 + 10 * (i + 1) + 7 * i}`);
  assert.compareArray(log, expected);
  assert.sameValue(state, 1 + 10 * pulls + 7 * count);
}
