/*---
description: "A generic generator is instantiated at number and string; node keeps exact signed zero, NaN and string values while ordering both loops against resumption."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-async-generators, ts-generics, ts-generic-constraints, ts-unions, ts-readonly, ts-numbers, ts-strings]
flags: [async]
---*/
// A generic generator is instantiated at number and string; node keeps exact signed zero, NaN and string values while ordering both loops against resumption.
const log: string[] = [];
async function* produce<T extends number | string>(values: readonly T[], label: string): AsyncGenerator<T, void, undefined> {
  for (let index = 0; index < values.length; index++) { log.push(label + ":yield:" + index); yield values[index]; log.push(label + ":resume:" + index); }
  log.push(label + ":finish");
}
async function main(): Promise<void> {
  for (const count of [0, 1, 3]) {
    log.length = 0; const numeric = [-0, NaN, 7].slice(0, count), textual = ["", "é", "last"].slice(0, count);
    const numbers: AsyncIterable<number> = produce<number>(numeric, "number"), words: AsyncIterable<string> = produce<string>(textual, "string");
    const seenNumbers: number[] = [], seenStrings: string[] = []; log.push("created");
    for await (const value of numbers) { log.push("number:loop:" + seenNumbers.length); seenNumbers.push(value); }
    log.push("between");
    for await (const value of words) { log.push("string:loop:" + seenStrings.length); seenStrings.push(value); }
    log.push("after"); const expected = ["created"];
    for (let index = 0; index < count; index++) expected.push("number:yield:" + index, "number:loop:" + index, "number:resume:" + index);
    expected.push("number:finish", "between");
    for (let index = 0; index < count; index++) expected.push("string:yield:" + index, "string:loop:" + index, "string:resume:" + index);
    expected.push("string:finish", "after");
    assert.compareArray(log, expected); assert.compareArray(seenNumbers, numeric); assert.compareArray(seenStrings, textual);
    assert.sameValue(seenNumbers.length, count); assert.sameValue(seenStrings.length, count);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
