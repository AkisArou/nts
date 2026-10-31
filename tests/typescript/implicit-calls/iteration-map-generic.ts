/*---
description: The Map constructor consumes a generic iterable of tuples, preserving hook effects and later values at duplicate keys.
features: [ts-implicit-iteration, ts-iteration, ts-interfaces, ts-symbols, ts-objects, ts-arrays, ts-generics, ts-generic-constraints, ts-map-set, ts-tuples]
---*/
// Implicit calls: new Map through a generic parameter; node consumes every pair before the last duplicate key value is observed.
const log: string[] = [];
let state = 0, expectedSource: object = {};
interface Cursor { next(sent?: number): IteratorResult<[number, number], number>; return(sent?: number): IteratorResult<[number, number], number>; }
interface Source { [Symbol.iterator](): Cursor; }
function open(owner: object, count: number, base: number, argc: number): Cursor {
  assert.sameValue(owner, expectedSource); state++; log.push(`iterator:${base}:${count}:${argc}:${state}`);
  let index = 0;
  const cursor: Cursor = {
    next(sent?: number): IteratorResult<[number, number], number> {
      assert.sameValue(this, cursor); state += 10 + (sent ?? 0);
      log.push(`next:${index}:${arguments.length}:${String(sent)}:${state}`);
      return index < count ? { done: false, value: [index % 2, base + index++] } : { done: true, value: 100 + count };
    },
    return(sent?: number): IteratorResult<[number, number], number> {
      assert.sameValue(this, cursor); state += 100; log.push(`return:${index}:${arguments.length}:${String(sent)}:${state}`);
      return { done: true, value: sent ?? -1 };
    }
  }; return cursor;
}
interface First extends Source { first: number; count: number; }
interface Second extends Source { second: number; count: number; }
function first(count: number): First { return { first: 10, count, [Symbol.iterator]() { return open(this, this.count, this.first, arguments.length); } }; }
function second(count: number): Second { return { second: 20, count, [Symbol.iterator]() { return open(this, this.count, this.second, arguments.length); } }; }
function consume<T extends Source>(source: T): number[] {
  const result = new Map(source);
  return [result.size, result.get(0) ?? -1, result.get(1) ?? -1];
}
for (const count of [0, 1, 3]) for (const source of [first(count), second(count)]) {
  log.length = 0; state = 0; expectedSource = source;
  const base = "first" in source ? source.first : source.second;
  const out = consume(source);
  assert.compareArray(out, [Math.min(count, 2), count === 0 ? -1 : base + (count === 3 ? 2 : 0), count < 2 ? -1 : base + 1]);
  const pulls = count + 1;
  const expected = [`iterator:${base}:${count}:0:1`];
  for (let i = 0; i < pulls; i++) expected.push(`next:${i}:0:undefined:${1 + 10 * (i + 1)}`);
  assert.compareArray(log, expected);
  assert.sameValue(state, 1 + 10 * pulls);
}
