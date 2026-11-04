/*---
description: "Async yield delegation through an interface with generator and handwritten implementations; node delivers every value before retaining the distinct string completion."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-generators, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-symbols, ts-unions, ts-arrow-functions]
flags: [async]
---*/
// Async yield delegation through an interface with generator and handwritten implementations; node delivers every value before retaining the distinct string completion.
const log: string[] = [];
interface Source extends AsyncIterable<number, string, void> { label: string; }
class Generated implements Source {
  label: string = "generated"; input: number[];
  constructor(input: number[]) { this.input = input; }
  async *[Symbol.asyncIterator](): AsyncIterableIterator<number, string, void> {
    log.push("iterator"); for (let index = 0; index < this.input.length; index++) { log.push("next:" + index); yield Promise.resolve(this.input[index]); }
    log.push("next:" + this.input.length); return "complete";
  }
}
class Manual implements Source {
  label: string = "manual"; input: number[];
  constructor(input: number[]) { this.input = input; }
  [Symbol.asyncIterator](): AsyncIterator<number, string, void> {
    log.push("iterator"); let index = 0; const input = this.input;
    return { async next() { log.push("next:" + index); return index < input.length ? { value: input[index++], done: false } : { value: "complete", done: true }; } };
  }
}
async function collect(source: Source): Promise<(number | string)[]> {
  const values: (number | string)[] = [];
  async function* outer(): AsyncIterableIterator<number, void, void> { log.push("outer:" + source.label); const result = yield* source; log.push("completion"); values.push(result); }
  for await (const value of outer()) { log.push("body:" + value); values.push(value); } log.push("after"); return values;
}
async function main(): Promise<void> {
  for (const input of [[], [-0], [1, 2, 3]]) for (const source of [new Generated(input), new Manual(input)]) {
    log.length = 0; const values = await collect(source); const expected = ["outer:" + source.label, "iterator"];
    for (let index = 0; index < input.length; index++) expected.push("next:" + index, "body:" + input[index]);
    expected.push("next:" + input.length, "completion", "after");
    assert.compareArray(log, expected); assert.compareArray(values, [...input, "complete"]);
    assert.sameValue(values[values.length - 1], "complete");
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
