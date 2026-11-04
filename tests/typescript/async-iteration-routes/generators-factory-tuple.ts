/*---
description: "A tuple element carries a generator function; node delays its selected body and yields exact values in producer-loop-resume order for every call."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-async-generators, ts-tuples, ts-function-types, ts-type-aliases, ts-numbers, ts-strings]
flags: [async]
---*/
// A tuple element carries a generator function; node delays its selected body and yields exact values in producer-loop-resume order for every call.
const log: string[] = [];
type Factory = (base: number, count: number) => AsyncIterable<number>;
async function* produce(base: number, count: number): AsyncGenerator<number, void, undefined> {
  log.push("start:" + base);
  for (let index = 0; index < count; index++) { log.push("yield:" + index); yield base + index; log.push("resume:" + index); }
  log.push("finish:" + base);
}
async function main(): Promise<void> {
  const factories: [string, Factory] = ["chosen", produce];
  for (const base of [2, 9]) for (const count of [0, 1, 3]) {
    log.length = 0; const source = factories[1](base, count), seen: number[] = []; log.push("created:" + factories[0]);
    for await (const value of source) { log.push("loop:" + seen.length); seen.push(value); }
    log.push("after"); const expected = ["created:chosen", "start:" + base], wanted: number[] = [];
    for (let index = 0; index < count; index++) { expected.push("yield:" + index, "loop:" + index, "resume:" + index); wanted.push(base + index); }
    expected.push("finish:" + base, "after");
    assert.compareArray(log, expected); assert.compareArray(seen, wanted); assert.sameValue(factories[1], produce);
    assert.sameValue(factories[0], "chosen"); assert.sameValue(seen.length, count);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
