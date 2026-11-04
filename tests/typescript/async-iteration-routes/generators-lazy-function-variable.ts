/*---
description: "A typed generator function stays lazy at creation; node starts each empty, short or long body only when the loop asks."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-async-generators, ts-function-types, ts-readonly, ts-numbers]
flags: [async]
---*/
// A typed generator function stays lazy at creation; node starts each empty, short or long body only when the loop asks.
const log: string[] = [];
type Factory = (values: readonly number[]) => AsyncIterable<number>;
async function* produce(values: readonly number[]): AsyncGenerator<number, void, undefined> {
  log.push("start");
  for (let index = 0; index < values.length; index++) {
    log.push("yield:" + index); yield values[index]; log.push("resume:" + index);
  }
  log.push("finish");
}
const factory: Factory = produce;
async function main(): Promise<void> {
  const rows: number[][] = [[], [-0], [2, NaN, 7]];
  for (const values of rows) {
    log.length = 0; const source = factory(values); log.push("created");
    const seen: number[] = [];
    for await (const value of source) { log.push("loop:" + seen.length); seen.push(value); }
    log.push("after");
    const expected = ["created", "start"];
    for (let index = 0; index < values.length; index++) expected.push("yield:" + index, "loop:" + index, "resume:" + index);
    expected.push("finish", "after");
    assert.compareArray(log, expected); assert.compareArray(seen, values);
    assert.sameValue(seen.length, values.length); assert.sameValue(factory, produce);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
