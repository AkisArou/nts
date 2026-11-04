/*---
description: "Control: A Map-held generator returns a promise; node waits for its completion before leaving the loop and never delivers that return value as an element."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-map-set, ts-readonly, ts-numbers, ts-arrow-functions, ts-narrowing, ts-null-undefined, ts-errors]
flags: [async]
---*/
// Synchronous control: A Map-held generator returns a promise; node waits for its completion before leaving the loop and never delivers that return value as an element.
const log: string[] = [];
function* produce(values: readonly number[]): Generator<number, Promise<number>, undefined> {
  for (let index = 0; index < values.length; index++) { log.push("yield:" + index); yield values[index]; log.push("resume:" + index); }
  log.push("return");
  return Promise.resolve(91).then(value => { log.push("settle:return"); return value; });
}
async function main(): Promise<void> {
  const rows: number[][] = [[], [-0], [2, NaN, 7]];
  for (const values of rows) {
    log.length = 0; const original = produce(values), sources: Map<string, Generator<number, Promise<number>, undefined>> = new Map([["active", original]]);
    log.push("created"); const source = sources.get("active"); if (source === undefined) throw new Error("missing source");
    const seen: number[] = [];
    while (true) { const step = source.next(), value = await step.value; if (step.done) break; log.push("loop:" + seen.length); seen.push(value); }
    log.push("after"); const expected = ["created"];
    for (let index = 0; index < values.length; index++) expected.push("yield:" + index, "loop:" + index, "resume:" + index);
    expected.push("return", "settle:return", "after");
    assert.compareArray(log, expected); assert.compareArray(seen, values);
    assert.sameValue(seen.length, values.length); assert.sameValue(sources.get("active"), original);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
