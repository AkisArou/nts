/*---
description: "A generic consumer at number and string type arguments preserves yield, loop and resume order for empty, short and long generators."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-async-generators, ts-generics, ts-readonly, ts-numbers, ts-strings]
flags: [async]
---*/
// A generic consumer at number and string type arguments preserves yield, loop and resume order for empty, short and long generators.
const log: string[] = [];
async function* numbers(values: readonly number[]): AsyncGenerator<number, void, undefined> {
  for (let index = 0; index < values.length; index++) { log.push("number:yield:" + index); yield values[index]; log.push("number:resume:" + index); }
  log.push("number:finish");
}
async function* words(values: readonly string[]): AsyncGenerator<string, void, undefined> {
  for (let index = 0; index < values.length; index++) { log.push("string:yield:" + index); yield values[index]; log.push("string:resume:" + index); }
  log.push("string:finish");
}
async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  log.push("collect"); const seen: T[] = [];
  for await (const value of source) { log.push("loop:" + seen.length); seen.push(value); }
  log.push("after"); return seen;
}
async function main(): Promise<void> {
  for (const count of [0, 1, 3]) {
    log.length = 0; const numeric = [-0, NaN, 7].slice(0, count), text = ["", "é", "tail"].slice(0, count);
    const first = await collect<number>(numbers(numeric)), second = await collect<string>(words(text));
    log.push("done"); const expected: string[] = [];
    for (const label of ["number", "string"]) {
      expected.push("collect");
      for (let index = 0; index < count; index++) expected.push(label + ":yield:" + index, "loop:" + index, label + ":resume:" + index);
      expected.push(label + ":finish", "after");
    }
    expected.push("done"); assert.compareArray(log, expected);
    assert.compareArray(first, numeric); assert.compareArray(second, text);
    assert.sameValue(first.length, count); assert.sameValue(second.length, count);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
