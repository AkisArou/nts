/*---
description: "An instanceof-narrowed union selects differently laid-out generator owners; node steps the correct method and retains each branch value sequence."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-async-generators, ts-class, ts-class-fields, ts-this, ts-unions, ts-instanceof, ts-narrowing, ts-numbers]
flags: [async]
---*/
// An instanceof-narrowed union selects differently laid-out generator owners; node steps the correct method and retains each branch value sequence.
const log: string[] = [];
class Forward {
  base: number = 2;
  async *values(count: number): AsyncGenerator<number, void, undefined> {
    log.push("forward:start");
    for (let index = 0; index < count; index++) { log.push("forward:yield:" + index); yield this.base + index; log.push("forward:resume:" + index); }
    log.push("forward:finish");
  }
}
class Backward {
  label: string = "backward"; start: number = 10;
  async *numbers(count: number): AsyncGenerator<number, void, undefined> {
    log.push(this.label + ":start");
    for (let index = 0; index < count; index++) { log.push(this.label + ":yield:" + index); yield this.start - index; log.push(this.label + ":resume:" + index); }
    log.push(this.label + ":finish");
  }
}
async function main(): Promise<void> {
  const owners: (Forward | Backward)[] = [new Forward(), new Backward()];
  for (const count of [0, 1, 3]) for (const owner of owners) {
    log.length = 0; const label = owner instanceof Forward ? "forward" : "backward"; log.push("select:" + label);
    const source = owner instanceof Forward ? owner.values(count) : owner.numbers(count), seen: number[] = [];
    for await (const value of source) { log.push("loop:" + seen.length); seen.push(value); }
    log.push("after"); const expected = ["select:" + label, label + ":start"], wanted: number[] = [];
    for (let index = 0; index < count; index++) {
      expected.push(label + ":yield:" + index, "loop:" + index, label + ":resume:" + index); wanted.push(label === "forward" ? 2 + index : 10 - index);
    }
    expected.push(label + ":finish", "after");
    assert.compareArray(log, expected); assert.compareArray(seen, wanted); assert.sameValue(seen.length, count);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
