/*---
description: "A tuple-held generator yields promises; node awaits each operand before the loop receives its exact numeric value."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-async-generators, ts-tuples, ts-readonly, ts-numbers, ts-arrow-functions, ts-closures, ts-typeof-operator]
flags: [async]
---*/
// A tuple-held generator yields promises; node awaits each operand before the loop receives its exact numeric value.
const log: string[] = [];
async function* produce(values: readonly number[]): AsyncGenerator<number, void, undefined> {
  for (let index = 0; index < values.length; index++) {
    log.push("yield:" + index);
    yield Promise.resolve(values[index]).then(value => { log.push("settle:" + index); return value; });
    log.push("resume:" + index);
  }
  log.push("finish");
}
async function main(): Promise<void> {
  const rows: number[][] = [[], [-0], [NaN, 2, 7]];
  for (const values of rows) {
    log.length = 0; const route: [string, AsyncIterable<number>] = ["ready", produce(values)]; log.push("created");
    const seen: number[] = [];
    for await (const value of route[1]) { log.push("loop:" + seen.length); seen.push(value); }
    log.push("after"); const expected = ["created"];
    for (let index = 0; index < values.length; index++) expected.push("yield:" + index, "settle:" + index, "loop:" + index, "resume:" + index);
    expected.push("finish", "after");
    assert.compareArray(log, expected); assert.compareArray(seen, values); assert.sameValue(route[0], "ready");
    for (const value of seen) assert.sameValue(typeof value, "number");
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
