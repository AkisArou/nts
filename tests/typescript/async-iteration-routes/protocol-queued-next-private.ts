/*---
description: "Queued async-generator next calls through a private factory settle in request order; node ignores the first send and delivers later sends to their suspended yields."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-errors, ts-type-aliases, ts-utility-types, ts-unknown, ts-arrow-functions, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-async-generators, ts-generators]
flags: [async]
---*/
// Queued async-generator next calls through a private factory settle in request order; node ignores the first send and delivers later sends to their suspended yields.
const log: string[] = [];
type Cursor = Pick<AsyncGenerator<number, number | undefined, number>, "next">;
async function* make(input: number): AsyncGenerator<number, number | undefined, number> {
  log.push("start"); log.push("yield:0"); const first = yield input;
  log.push("resume:0"); log.push("yield:1"); const second = yield input + first;
  log.push("resume:1"); log.push("return"); return input + first + second;
}
class Holder { #factory: (input: number) => Cursor = make; open(input: number): Cursor { return this.#factory(input); } }
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    log.length = 0; const source = new Holder().open(input);
    const first = source.next(99), second = source.next(4), third = source.next(5), fourth = source.next(8), settled: number[] = [];
    const results = await Promise.all([first, second, third, fourth].map((pending, index) => pending.then(step => { settled.push(index); return step; })));
    log.push("after"); assert.sameValue(first === second, false); assert.compareArray(settled, [0, 1, 2, 3]);
    assert.compareArray(results.map(step => step.done), [false, false, true, true]); assert.compareArray(results.map(step => step.value), [input, input + 4, input + 9, undefined]);
    assert.sameValue(results[0] === results[1], false); assert.sameValue(results[2] === results[3], false);
    assert.compareArray(log, ["start", "yield:0", "resume:0", "yield:1", "resume:1", "return", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
