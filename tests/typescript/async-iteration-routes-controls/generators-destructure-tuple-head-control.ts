/*---
description: "Control: A tuple-held generator feeds a tuple destructuring loop head; node binds each key and exact numeric value before resuming the producer."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-tuples, ts-readonly, ts-numbers, ts-strings, ts-destructuring, ts-type-aliases]
flags: [async]
---*/
// Synchronous control: A tuple-held generator feeds a tuple destructuring loop head; node binds each key and exact numeric value before resuming the producer.
const log: string[] = [];
type Entry = readonly [string, number];
function* produce(values: readonly Entry[]): Generator<Entry, void, undefined> {
  for (let index = 0; index < values.length; index++) { log.push("yield:" + index); yield values[index]; log.push("resume:" + index); }
  log.push("finish");
}
async function main(): Promise<void> {
  const rows: Entry[][] = [[], [["a", -0]], [["a", 2], ["b", NaN], ["c", 7]]];
  for (const values of rows) {
    log.length = 0; const source: [string, Iterable<Entry>] = ["entries", produce(values)], keys: string[] = [], numbers: number[] = [];
    for (const pending of source[1]) { const [key, value] = await pending; log.push("loop:" + key); keys.push(key); numbers.push(value); }
    log.push("after"); const expected: string[] = [], wantedKeys: string[] = [], wantedNumbers: number[] = [];
    for (let index = 0; index < values.length; index++) {
      expected.push("yield:" + index, "loop:" + values[index][0], "resume:" + index);
      wantedKeys.push(values[index][0]); wantedNumbers.push(values[index][1]);
    }
    expected.push("finish", "after");
    assert.compareArray(log, expected); assert.compareArray(keys, wantedKeys); assert.compareArray(numbers, wantedNumbers);
    assert.sameValue(source[0], "entries"); assert.sameValue(keys.length, values.length);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
