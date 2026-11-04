/*---
description: "Control: An interface-typed object literal carries a generator method; node retains its this receiver and observes prefix changes only after each loop body."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-interfaces, ts-objects, ts-this, ts-strings]
flags: [async]
---*/
// Synchronous control: An interface-typed object literal carries a generator method; node retains its this receiver and observes prefix changes only after each loop body.
const log: string[] = [];
interface Feed { prefix: string; values(count: number): Iterable<string>; }
async function main(): Promise<void> {
  for (const prefix of ["a", "é"]) for (const count of [0, 1, 3]) {
    log.length = 0;
    const feed: Feed = {
      prefix,
      *values(count: number): Generator<string, void, undefined> {
        log.push("start");
        for (let index = 0; index < count; index++) { log.push("yield:" + index); yield this.prefix + index; log.push("resume:" + index); }
        log.push("finish");
      }
    };
    const source = feed.values(count), seen: string[] = []; log.push("created");
    for (const pending of source) { const value = await pending;
      log.push("loop:" + seen.length); seen.push(value); if (seen.length === 1) { log.push("write"); feed.prefix += "!"; }
    }
    log.push("after"); const expected = ["created", "start"], wanted: string[] = [];
    for (let index = 0; index < count; index++) {
      expected.push("yield:" + index, "loop:" + index); if (index === 0) expected.push("write"); expected.push("resume:" + index);
      wanted.push(prefix + (index === 0 ? "" : "!") + index);
    }
    expected.push("finish", "after");
    assert.compareArray(log, expected); assert.compareArray(seen, wanted); assert.sameValue(feed.prefix, prefix + (count === 0 ? "" : "!"));
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
