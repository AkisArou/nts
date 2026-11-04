/*---
description: "Control: Breaking for-await through two sync iterator interface implementations; node calls return with no arguments and awaits its promised value before continuing."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-objects, ts-unions, ts-symbols, ts-arrow-functions]
flags: [async]
---*/
// Breaking for-await through two sync iterator interface implementations; node calls return with no arguments and awaits its promised value before continuing.
const log: string[] = [];
interface Source extends IterableIterator<number | Promise<number>, void | Promise<void>, void> { closed: number; return(value?: void | Promise<void>): IteratorResult<number | Promise<number>, void | Promise<void>>; }
class Cursor implements Source {
  index: number = 0; closed: number = 0; input: number[];
  constructor(input: number[]) { this.input = input; }
  [Symbol.iterator](): Source { log.push("iterator"); return this; }
  next(): IteratorResult<number | Promise<number>, void | Promise<void>> {
    log.push("next:" + this.index + ":" + arguments.length); return this.index < this.input.length ? { value: Promise.resolve(this.input[this.index++]), done: false } : { value: undefined, done: true };
  }
  return(): IteratorResult<number | Promise<number>, void | Promise<void>> {
    this.closed++; log.push("return:" + arguments.length); return { value: Promise.resolve().then(() => { log.push("return:end"); }), done: true };
  }
}
function literal(input: number[]): Source {
  let index = 0; return { closed: 0,
    [Symbol.iterator]() { log.push("iterator"); return this; },
    next() { log.push("next:" + index + ":" + arguments.length); return index < input.length ? { value: Promise.resolve(input[index++]), done: false } : { value: undefined, done: true }; },
    return() { this.closed++; log.push("return:" + arguments.length); return { value: Promise.resolve().then(() => { log.push("return:end"); }), done: true }; }
  };
}
async function collect(source: Source): Promise<number[]> {
  const values: number[] = [];
  const iterator = source[Symbol.iterator](); const step = iterator.next();
  if (step.done) await step.value;
  else { const value = await step.value; log.push("body:" + value); values.push(value); if (iterator.return) await iterator.return().value; }
  log.push("after"); return values;
}
async function main(): Promise<void> {
  for (const input of [[], [-0], [1, 2, 3]]) for (const source of [new Cursor(input), literal(input)]) {
    log.length = 0; const values = await collect(source); const expected = ["iterator", "next:0:0"];
    if (input.length) expected.push("body:" + input[0], "return:0", "return:end"); expected.push("after");
    assert.compareArray(log, expected); assert.compareArray(values, input.slice(0, 1)); assert.sameValue(source.closed, input.length ? 1 : 0);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
