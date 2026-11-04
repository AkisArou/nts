/*---
description: "An instance generator reads its private field at each yield; node observes the loop body update on the next resume through the same receiver."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-async-generators, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-numbers]
flags: [async]
---*/
// An instance generator reads its private field at each yield; node observes the loop body update on the next resume through the same receiver.
const log: string[] = [];
class Source {
  #value: number;
  constructor(value: number) { log.push("construct"); this.#value = value; }
  write(value: number): void { log.push("write"); this.#value = value; }
  read(): number { log.push("read"); return this.#value; }
  async *values(count: number): AsyncGenerator<number, void, undefined> {
    for (let index = 0; index < count; index++) { log.push("yield:" + index); yield this.#value; log.push("resume:" + index); }
    log.push("finish");
  }
}
async function main(): Promise<void> {
  for (const start of [2, 9]) for (const count of [1, 3]) {
    log.length = 0; const owner: Source = new Source(start), source = owner.values(count), seen: number[] = [];
    log.push("created");
    for await (const value of source) { log.push("loop:" + seen.length); seen.push(value); if (seen.length === 1) owner.write(start + 10); }
    const current = owner.read(); log.push("after"); const expected = ["construct", "created"], wanted: number[] = [];
    for (let index = 0; index < count; index++) {
      expected.push("yield:" + index, "loop:" + index); if (index === 0) expected.push("write"); expected.push("resume:" + index);
      wanted.push(index === 0 ? start : start + 10);
    }
    expected.push("finish", "read", "after");
    assert.compareArray(log, expected); assert.compareArray(seen, wanted); assert.sameValue(current, start + 10);
    assert.sameValue(seen.length, count);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
