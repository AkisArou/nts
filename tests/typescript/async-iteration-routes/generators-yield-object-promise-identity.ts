/*---
description: "An interface method supplies a promised object to yield; node hands the loop that exact object and the resumed producer sees its body mutation."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-async-generators, ts-interfaces, ts-readonly, ts-objects, ts-numbers, ts-arrow-functions, ts-instanceof, ts-typeof-operator]
flags: [async]
---*/
// An interface method supplies a promised object to yield; node hands the loop that exact object and the resumed producer sees its body mutation.
const log: string[] = [];
interface Payload { value: number; }
interface Input { readonly payload: Payload; promise(): Promise<Payload>; }
async function* produce(input: Input): AsyncGenerator<Payload, void, undefined> {
  log.push("yield"); yield input.promise(); log.push("resume"); log.push("observed:" + input.payload.value); log.push("finish");
}
async function main(): Promise<void> {
  for (const start of [2, 9]) {
    log.length = 0; const payload: Payload = { value: start };
    const input: Input = { payload, promise() { log.push("promise"); return Promise.resolve(payload).then(value => { log.push("settle"); return value; }); } };
    const source = produce(input), seen: Payload[] = []; log.push("created");
    for await (const value of source) { log.push("loop"); seen.push(value); value.value += 10; log.push("write"); }
    log.push("after");
    assert.compareArray(log, ["created", "yield", "promise", "settle", "loop", "write", "resume", "observed:" + (start + 10), "finish", "after"]);
    assert.sameValue(seen.length, 1); assert.sameValue(seen[0], payload); assert.sameValue(input.payload, payload);
    assert.sameValue(payload.value, start + 10); assert.sameValue(seen[0] instanceof Promise, false); assert.sameValue(typeof seen[0], "object");
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
