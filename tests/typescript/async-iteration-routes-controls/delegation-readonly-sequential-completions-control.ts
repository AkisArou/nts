/*---
description: "Control: Sequential async yield delegation through a readonly source array; node retains each completion and never closes a naturally completed delegate."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-class, ts-class-fields, ts-readonly, ts-symbols, ts-objects, ts-this, ts-arrow-functions]
flags: [async]
---*/
// Sequential async yield delegation through a readonly source array; node retains each completion and never closes a naturally completed delegate.
const log: string[] = [];
class Source implements AsyncIterableIterator<number, string, void> {
  index: number = 0; label: string; input: number[];
  constructor(label: string, input: number[]) { this.label = label; this.input = input; }
  [Symbol.asyncIterator](): Source { log.push("iterator:" + this.label); return this; }
  async next(): Promise<IteratorResult<number, string>> {
    log.push(this.label + ":next:" + this.index);
    return this.index < this.input.length ? { value: this.input[this.index++], done: false } : { value: this.label, done: true };
  }
  async return(): Promise<IteratorResult<number, string>> { log.push("unexpected:return"); return { value: "closed", done: true }; }
}
async function collect(sources: readonly AsyncIterable<number, string, void>[]): Promise<{ values: number[]; completions: string[] }> {
  const values: number[] = [], completions: string[] = [];
  log.push("outer:start"); for (const source of sources) {
    const iterator = source[Symbol.asyncIterator]();
    while (true) { const step = await iterator.next(); if (step.done) { const value = step.value; log.push("complete:" + value); completions.push(value); break; }
      const value = await step.value; log.push("body:" + value); values.push(value); }
  }
  log.push("after"); return { values, completions };
}
async function main(): Promise<void> {
  for (const input of [[], [-0], [1, 2, 3]]) {
    log.length = 0; const sources: readonly AsyncIterable<number, string, void>[] = [new Source("first", input), new Source("second", [9])];
    const result = await collect(sources); const expected = ["outer:start", "iterator:first"];
    for (let index = 0; index < input.length; index++) expected.push("first:next:" + index, "body:" + input[index]);
    expected.push("first:next:" + input.length, "complete:first", "iterator:second", "second:next:0", "body:9", "second:next:1", "complete:second", "after");
    assert.compareArray(log, expected); assert.compareArray(result.values, [...input, 9]); assert.compareArray(result.completions, ["first", "second"]);
    assert.sameValue(sources.length, 2);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
