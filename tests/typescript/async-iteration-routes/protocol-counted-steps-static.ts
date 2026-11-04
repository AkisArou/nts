/*---
description: "A custom async source through the static route is acquired once and awaits each next result before the body; node records n+1 next calls and no return on exhaustion."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-async-generators, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-class, ts-class-fields, ts-this, ts-symbols, ts-generics, ts-numbers, ts-strings, ts-errors, ts-static, ts-readonly]
flags: [async]
---*/
// A custom async source through the static route is acquired once and awaits each next result before the body; node records n+1 next calls and no return on exhaustion.
const log: string[] = [];
class Values<T> implements AsyncIterable<T> {
  items: readonly T[]; opens = 0; steps = 0; returns = 0;
  constructor(items: readonly T[]) { this.items = items; }
  [Symbol.asyncIterator](): AsyncIterator<T, void, unknown> {
    log.push("iterator"); this.opens++; const owner = this; let index = 0;
    return { async next(): Promise<IteratorResult<T, void>> {
      log.push("next:" + index); owner.steps++; await Promise.resolve(); log.push("ready:" + index);
      return index < owner.items.length ? { value: owner.items[index++], done: false } : { value: undefined, done: true };
    }, async return(): Promise<IteratorResult<T, void>> { log.push("return"); owner.returns++; return { value: undefined, done: true }; } };
  }
}
class Holder { static open<T>(input: readonly T[]): Values<T> { return new Values(input); } }
async function consume<Value>(input: readonly Value[]): Promise<void> {
  const source = Holder.open(input);
  log.length = 0; const seen: Value[] = [];
  for await (const value of source) { log.push("body"); seen.push(value); } log.push("after");
  const expected: string[] = ["iterator"]; for (let index = 0; index <= input.length; index++) { expected.push("next:" + index, "ready:" + index); if (index < input.length) expected.push("body"); } expected.push("after");
  assert.compareArray(seen, input); assert.sameValue(source.opens, 1); assert.sameValue(source.steps, input.length + 1); assert.sameValue(source.returns, 0);
  assert.compareArray(log, expected);
}
async function run(): Promise<void> { for (const input of [[], [2], [3, 4, 5]]) await consume(input); }
run().then(() => $DONE(), (error: unknown) => $DONE(error));
