/*---
description: "A generator function read from a typed Map stays selected after the entry is replaced; node walks the original positive or negative factory in order."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-async-generators, ts-map-set, ts-function-types, ts-type-aliases, ts-narrowing, ts-numbers, ts-strings]
flags: [async]
---*/
// A generator function read from a typed Map stays selected after the entry is replaced; node walks the original positive or negative factory in order.
const log: string[] = [];
type Factory = (count: number) => AsyncIterable<number>;
async function* positive(count: number): AsyncGenerator<number, void, undefined> {
  log.push("positive:start");
  for (let index = 0; index < count; index++) { log.push("positive:yield:" + index); yield index + 2; log.push("positive:resume:" + index); }
  log.push("positive:finish");
}
async function* negative(count: number): AsyncGenerator<number, void, undefined> {
  log.push("negative:start");
  for (let index = 0; index < count; index++) { log.push("negative:yield:" + index); yield -index - 2; log.push("negative:resume:" + index); }
  log.push("negative:finish");
}
async function main(): Promise<void> {
  for (const label of ["positive", "negative"]) for (const count of [0, 1, 3]) {
    log.length = 0; const factories: Map<string, Factory> = new Map([["positive", positive], ["negative", negative]]);
    const factory = factories.get(label); if (factory === undefined) throw new Error("missing factory");
    log.push("selected:" + label); const source = factory(count), seen: number[] = [];
    const replacement = label === "positive" ? negative : positive; factories.set(label, replacement); log.push("replaced");
    for await (const value of source) { log.push("loop:" + seen.length); seen.push(value); }
    log.push("after"); const expected = ["selected:" + label, "replaced", label + ":start"], wanted: number[] = [];
    for (let index = 0; index < count; index++) {
      expected.push(label + ":yield:" + index, "loop:" + index, label + ":resume:" + index); wanted.push((index + 2) * (label === "positive" ? 1 : -1));
    }
    expected.push(label + ":finish", "after");
    assert.compareArray(log, expected); assert.compareArray(seen, wanted); assert.sameValue(factories.get(label), replacement);
    assert.sameValue(factory, label === "positive" ? positive : negative); assert.sameValue(seen.length, count);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
