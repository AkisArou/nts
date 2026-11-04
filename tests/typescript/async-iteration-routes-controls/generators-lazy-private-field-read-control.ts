/*---
description: "Control: An instance generator reads its private field only at its first step; node sees the write made after generator creation."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-numbers]
flags: [async]
---*/
// Synchronous control: An instance generator reads its private field only at its first step; node sees the write made after generator creation.
const log: string[] = [];
class Source {
  #base: number;
  constructor(base: number) { log.push("construct"); this.#base = base; }
  write(value: number): void { log.push("write"); this.#base = value; }
  *values(count: number): Generator<number, void, undefined> {
    log.push("start"); const base = this.#base;
    for (let index = 0; index < count; index++) { log.push("yield:" + index); yield base + index; log.push("resume:" + index); }
    log.push("finish");
  }
}
async function main(): Promise<void> {
  for (const base of [2, 9]) for (const count of [0, 1, 3]) {
    log.length = 0; const owner = new Source(base), source = owner.values(count);
    log.push("created"); owner.write(base + 10);
    const seen: number[] = [];
    for (const pending of source) { const value = await pending; log.push("loop:" + seen.length); seen.push(value); }
    log.push("after"); const expected = ["construct", "created", "write", "start"], values: number[] = [];
    for (let index = 0; index < count; index++) { expected.push("yield:" + index, "loop:" + index, "resume:" + index); values.push(base + 10 + index); }
    expected.push("finish", "after");
    assert.compareArray(log, expected); assert.compareArray(seen, values); assert.sameValue(seen.length, count);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
