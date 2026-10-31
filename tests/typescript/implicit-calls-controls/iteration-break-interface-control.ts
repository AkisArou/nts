/*---
description: Control for iteration-break-interface; protocol acquisition, stepping and closing are explicit.
features: [ts-implicit-iteration, ts-iteration, ts-interfaces, ts-symbols, ts-objects, ts-arrays]
---*/
// Control: ../implicit-calls/iteration-break-interface.ts; only the implicit protocol consumer becomes explicit.
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
function consume(source: Source): number[] {
  const out: number[] = [], cursor = source[Symbol.iterator]();
  for (let step = cursor.next(); !step.done; step = cursor.next()) { out.push(step.value); if (step.value % 2 === 1) { cursor.return(); break; } } return out;
}
for (const count of [0, 1, 3]) for (const source of [first(count), second(count)]) {
  log.length = 0; state = 0; expectedSource = source;
  const base = "first" in source ? source.first : source.second;
  const out = consume(source);
  const values: number[] = []; for (let i = 0; i < Math.min(count, 2); i++) values.push(base + i);
  assert.compareArray(out, values);
  const pulls = count < 2 ? count + 1 : 2, closed = count > 1;
  const expected = [`iterator:${base}:${count}:0:1`];
  for (let i = 0; i < pulls; i++) expected.push(`next:${i}:0:undefined:${1 + 10 * (i + 1)}`);
  if (closed) expected.push(`return:${pulls}:0:undefined:${1 + 10 * pulls + 100}`);
  assert.compareArray(log, expected);
  assert.sameValue(state, 1 + 10 * pulls + (closed ? 100 : 0));
}
