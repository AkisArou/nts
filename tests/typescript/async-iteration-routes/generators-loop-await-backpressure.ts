/*---
description: "A private consumer method awaits each loop-body transformation; node resumes the generator only after that step settles and its body finishes."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-async-generators, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly, ts-numbers, ts-arrow-functions]
flags: [async]
---*/
// A private consumer method awaits each loop-body transformation; node resumes the generator only after that step settles and its body finishes.
const log: string[] = [];
async function* produce(values: readonly number[]): AsyncGenerator<number, void, undefined> {
  for (let index = 0; index < values.length; index++) { log.push("yield:" + index); yield values[index]; log.push("resume:" + index); }
  log.push("finish");
}
class Consumer {
  #seen: number[] = [];
  collect(source: AsyncIterable<number>): Promise<number[]> { log.push("collect"); return this.#walk(source); }
  async #walk(source: AsyncIterable<number>): Promise<number[]> {
    for await (const value of source) {
      const index = this.#seen.length; log.push("body:start:" + index);
      const changed = await Promise.resolve(value).then(item => { log.push("body:settle:" + index); return item + 100; });
      this.#seen.push(changed); log.push("body:end:" + index);
    }
    log.push("after"); return this.#seen;
  }
}
async function main(): Promise<void> {
  const rows: number[][] = [[], [2], [3, 5, 7]];
  for (const values of rows) {
    log.length = 0; const consumer: Consumer = new Consumer(), seen = await consumer.collect(produce(values)); log.push("done");
    const expected = ["collect"], wanted: number[] = [];
    for (let index = 0; index < values.length; index++) {
      expected.push("yield:" + index, "body:start:" + index, "body:settle:" + index, "body:end:" + index, "resume:" + index); wanted.push(values[index] + 100);
    }
    expected.push("finish", "after", "done");
    assert.compareArray(log, expected); assert.compareArray(seen, wanted); assert.sameValue(seen.length, values.length);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
