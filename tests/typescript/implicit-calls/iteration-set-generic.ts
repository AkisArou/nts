/*---
description: The Set constructor consumes every value from a generic iterable, including duplicate values and the done result.
features: [ts-implicit-iteration, ts-iteration, ts-interfaces, ts-symbols, ts-objects, ts-arrays, ts-generics, ts-generic-constraints, ts-map-set, ts-spread]
---*/
// Implicit calls: new Set through a generic parameter; node still calls next for duplicate values before deduplicating the result.
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
      return index < count ? { done: false, value: base + index++ % 2 } : { done: true, value: 100 + count };
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
function consume<T extends Source>(source: T): number[] {
  const result = new Set(source);
  return [...result];
}
for (const count of [0, 1, 3]) for (const source of [first(count), second(count)]) {
  log.length = 0; state = 0; expectedSource = source;
  const base = "first" in source ? source.first : source.second;
  const out = consume(source);
  const values: number[] = []; for (let i = 0; i < Math.min(count, 2); i++) values.push(base + i);
  assert.compareArray(out, values);
  const pulls = count + 1;
  const expected = [`iterator:${base}:${count}:0:1`];
  for (let i = 0; i < pulls; i++) expected.push(`next:${i}:0:undefined:${1 + 10 * (i + 1)}`);
  assert.compareArray(log, expected);
  assert.sameValue(state, 1 + 10 * pulls);
}
