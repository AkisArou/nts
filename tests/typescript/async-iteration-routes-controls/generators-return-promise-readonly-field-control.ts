/*---
description: "Control: A readonly interface field carries a hand-stepped generator; node awaits its promised return and exposes the exact payload in the done result."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-interfaces, ts-readonly, ts-objects, ts-numbers, ts-unknown, ts-instanceof, ts-typeof-operator, ts-arrow-functions]
flags: [async]
---*/
// Synchronous control: A readonly interface field carries a hand-stepped generator; node awaits its promised return and exposes the exact payload in the done result.
const log: string[] = [];
interface Payload { id: number; }
interface Holder { readonly source: Generator<number, Promise<Payload>, undefined>; }
function* produce(base: number, payload: Payload): Generator<number, Promise<Payload>, undefined> {
  log.push("yield"); yield base; log.push("resume"); log.push("return");
  return Promise.resolve(payload).then(value => { log.push("settle:return"); return value; });
}
async function main(): Promise<void> {
  for (const base of [2, 9]) {
    log.length = 0; const payload: Payload = { id: base + 10 }, holder: Holder = { source: produce(base, payload) }; log.push("created");
    const first = await holder.source.next(); log.push("first");
    const pending = holder.source.next(); const done = { done: pending.done, value: await pending.value }; log.push("done"); const returned: unknown = done.value; log.push("after");
    assert.compareArray(log, ["created", "yield", "first", "resume", "return", "settle:return", "done", "after"]);
    assert.sameValue(first.done, false); assert.sameValue(first.value, base); assert.sameValue(done.done, true);
    assert.sameValue(done.value, payload); assert.sameValue(returned instanceof Promise, false); assert.sameValue(typeof returned, "object");
    assert.sameValue(payload.id, base + 10);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
