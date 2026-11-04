/*---
description: "A typed constructor carries a static generator using this; node sees the static write from the first loop body on every later yield."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-async-generators, ts-class, ts-class-fields, ts-static, ts-this, ts-typeof-type, ts-numbers]
flags: [async]
---*/
// A typed constructor carries a static generator using this; node sees the static write from the first loop body on every later yield.
const log: string[] = [];
class Source {
  static base: number = 0;
  static async *values(count: number): AsyncGenerator<number, void, undefined> {
    log.push("start");
    for (let index = 0; index < count; index++) { log.push("yield:" + index); yield this.base + index; log.push("resume:" + index); }
    log.push("finish");
  }
}
async function main(): Promise<void> {
  const owner: typeof Source = Source;
  for (const base of [2, 9]) for (const count of [0, 1, 3]) {
    log.length = 0; owner.base = base; const source = owner.values(count), seen: number[] = []; log.push("created");
    for await (const value of source) {
      log.push("loop:" + seen.length); seen.push(value); if (seen.length === 1) { log.push("write"); owner.base += 10; }
    }
    log.push("after"); const expected = ["created", "start"], wanted: number[] = [];
    for (let index = 0; index < count; index++) {
      expected.push("yield:" + index, "loop:" + index); if (index === 0) expected.push("write"); expected.push("resume:" + index);
      wanted.push(base + index + (index === 0 ? 0 : 10));
    }
    expected.push("finish", "after");
    assert.compareArray(log, expected); assert.compareArray(seen, wanted); assert.sameValue(owner.base, base + (count === 0 ? 0 : 10));
    assert.sameValue(owner, Source);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
