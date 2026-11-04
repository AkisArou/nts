/*---
description: "Control: Queued async-generator next calls through a tuple factory settle in request order; node ignores the first send and delivers later sends to their suspended yields."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-errors, ts-type-aliases, ts-utility-types, ts-unknown, ts-arrow-functions, ts-tuples, ts-class, ts-class-fields, ts-this]
flags: [async]
---*/
// Queued async-generator next calls through a tuple factory settle in request order; node ignores the first send and delivers later sends to their suspended yields.
const log: string[] = [];
type Cursor = Pick<AsyncGenerator<number, number | undefined, number>, "next">;
class Sequence {
  input: number; total: number; index = 0; tail: Promise<void> = Promise.resolve();
  constructor(input: number) { this.input = input; this.total = input; }
  next(value?: number): Promise<IteratorResult<number, number | undefined>> {
    const result = this.tail.then(() => this.take(value)); this.tail = result.then(() => {}, () => {}); return result;
  }
  take(value?: number): IteratorResult<number, number | undefined> {
    if (this.index === 0) { this.index++; log.push("start"); log.push("yield:0"); return { value: this.input, done: false }; }
    if (this.index === 1) { this.index++; this.total += value === undefined ? 0 : value; log.push("resume:0"); log.push("yield:1"); return { value: this.total, done: false }; }
    if (this.index === 2) { this.index++; this.total += value === undefined ? 0 : value; log.push("resume:1"); log.push("return"); return { value: this.total, done: true }; }
    return { value: undefined, done: true };
  }
}
function make(input: number): Cursor { return new Sequence(input); }

async function run(): Promise<void> {
  for (const input of [3, 7]) {
    log.length = 0; const slot: [string, (input: number) => Cursor] = ["source", make]; const source = slot[1](input);
    const first = source.next(99), second = source.next(4), third = source.next(5), fourth = source.next(8), settled: number[] = [];
    const results = await Promise.all([first, second, third, fourth].map((pending, index) => pending.then(step => { settled.push(index); return step; })));
    log.push("after"); assert.sameValue(first === second, false); assert.compareArray(settled, [0, 1, 2, 3]);
    assert.compareArray(results.map(step => step.done), [false, false, true, true]); assert.compareArray(results.map(step => step.value), [input, input + 4, input + 9, undefined]);
    assert.sameValue(results[0] === results[1], false); assert.sameValue(results[2] === results[3], false);
    assert.compareArray(log, ["start", "yield:0", "resume:0", "yield:1", "resume:1", "return", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
