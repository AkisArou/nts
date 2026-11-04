/*---
description: "A public typed method returns a private generator; node runs the wrapper immediately but delays the private body and preserves yield-loop-resume order."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-async-generators, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-numbers]
flags: [async]
---*/
// A public typed method returns a private generator; node runs the wrapper immediately but delays the private body and preserves yield-loop-resume order.
const log: string[] = [];
class Source {
  #base: number;
  constructor(base: number) { log.push("construct"); this.#base = base; }
  create(count: number): AsyncIterable<number> { log.push("create"); return this.#stream(count); }
  async *#stream(count: number): AsyncGenerator<number, void, undefined> {
    log.push("private:start");
    for (let index = 0; index < count; index++) { log.push("yield:" + index); yield this.#base + index; log.push("resume:" + index); }
    log.push("private:finish");
  }
}
async function main(): Promise<void> {
  for (const base of [2, 9]) for (const count of [0, 1, 3]) {
    log.length = 0; const owner: Source = new Source(base), source = owner.create(count), seen: number[] = [];
    log.push("created");
    for await (const value of source) { log.push("loop:" + seen.length); seen.push(value); }
    log.push("after"); const expected = ["construct", "create", "created", "private:start"], wanted: number[] = [];
    for (let index = 0; index < count; index++) { expected.push("yield:" + index, "loop:" + index, "resume:" + index); wanted.push(base + index); }
    expected.push("private:finish", "after");
    assert.compareArray(log, expected); assert.compareArray(seen, wanted); assert.sameValue(seen.length, count);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
