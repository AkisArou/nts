/*---
description: "Generators from two class instances are stepped in turn; node keeps private counters and suspension positions independent."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-async-generators, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-tuples, ts-numbers, ts-unions, ts-null-undefined]
flags: [async]
---*/
// Generators from two class instances are stepped in turn; node keeps private counters and suspension positions independent.
const log: string[] = [];
class Source {
  label: string; #next: number;
  constructor(label: string, start: number) { log.push("construct:" + label); this.label = label; this.#next = start; }
  async *values(count: number): AsyncGenerator<number, void, undefined> {
    for (let index = 0; index < count; index++) { log.push(this.label + ":yield:" + index); yield this.#next++; log.push(this.label + ":resume:" + index); }
    log.push(this.label + ":finish");
  }
  current(): number { log.push("read:" + this.label); return this.#next; }
}
async function main(): Promise<void> {
  for (const start of [2, 10]) for (const count of [1, 3]) {
    log.length = 0; const owners: [Source, Source] = [new Source("a", start), new Source("b", start + 20)];
    const cursors = [owners[0].values(count), owners[1].values(count)]; log.push("created");
    const values: unknown[] = [], dones: (boolean | undefined)[] = [], expected = ["construct:a", "construct:b", "created"], wanted: unknown[] = [];
    for (let turn = 0; turn <= count; turn++) for (let index = 0; index < 2; index++) {
      const step = await cursors[index].next(), label = owners[index].label;
      log.push("take:" + label + ":" + turn); values.push(step.value); dones.push(step.done);
      if (turn > 0) expected.push(label + ":resume:" + (turn - 1));
      expected.push(label + (turn < count ? ":yield:" + turn : ":finish"), "take:" + label + ":" + turn);
      wanted.push(turn < count ? start + index * 20 + turn : undefined);
    }
    const a = owners[0].current(), b = owners[1].current(); log.push("after"); expected.push("read:a", "read:b", "after");
    assert.compareArray(log, expected); assert.compareArray(values, wanted);
    for (let index = 0; index < dones.length; index++) assert.sameValue(dones[index], index >= count * 2);
    assert.sameValue(a, start + count); assert.sameValue(b, start + 20 + count); assert.sameValue(cursors[0] === cursors[1], false);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
