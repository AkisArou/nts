/*---
description: "Breaking async yield delegation through two interface implementations; node forwards one undefined argument to inner next and return, awaits return, and closes only once."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-generators, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-symbols, ts-objects, ts-unions, ts-arrow-functions]
flags: [async]
---*/
// Breaking async yield delegation through two interface implementations; node forwards one undefined argument to inner next and return, awaits return, and closes only once.
const log: string[] = [];
interface Source extends AsyncIterableIterator<number, void, void> { closed: number; return(value?: void | PromiseLike<void>): Promise<IteratorResult<number, void>>; }
class Cursor implements Source {
  index: number = 0; closed: number = 0; input: number[];
  constructor(input: number[]) { this.input = input; }
  [Symbol.asyncIterator](): Source { log.push("iterator"); return this; }
  async next(): Promise<IteratorResult<number, void>> { log.push("next:" + this.index + ":" + arguments.length); return this.index < this.input.length ? { value: this.input[this.index++], done: false } : { value: undefined, done: true }; }
  async return(value?: void | PromiseLike<void>): Promise<IteratorResult<number, void>> {
    this.closed++; log.push("return:" + arguments.length + ":" + value); await Promise.resolve(); log.push("return:end"); return { value: undefined, done: true };
  }
}
function literal(input: number[]): Source {
  let index = 0; return { closed: 0,
    [Symbol.asyncIterator]() { log.push("iterator"); return this; },
    async next() { log.push("next:" + index + ":" + arguments.length); return index < input.length ? { value: input[index++], done: false } : { value: undefined, done: true }; },
    async return(value?: void | PromiseLike<void>) { this.closed++; log.push("return:" + arguments.length + ":" + value); await Promise.resolve(); log.push("return:end"); return { value: undefined, done: true }; }
  };
}
async function collect(source: Source): Promise<number[]> {
  const values: number[] = [];
  async function* outer(): AsyncIterableIterator<number, void, void> {
    try { log.push("outer:start"); yield* source; } finally { log.push("outer:finally"); }
  }
  for await (const value of outer()) { log.push("body:" + value); values.push(value); break; }
  log.push("after"); return values;
}
async function main(): Promise<void> {
  for (const input of [[], [-0], [1, 2, 3]]) for (const source of [new Cursor(input), literal(input)]) {
    log.length = 0; const values = await collect(source); const expected = ["outer:start", "iterator", "next:0:1"];
    if (input.length) expected.push("body:" + input[0], "return:1:undefined", "return:end"); expected.push("outer:finally", "after");
    assert.compareArray(log, expected); assert.compareArray(values, input.slice(0, 1));
    assert.sameValue(source.closed, input.length ? 1 : 0);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
