/*---
description: "Control: For-await over a Set through two interface implementations; node awaits promised duplicates while retaining Set-normalized positive zero and promised negative zero."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-objects, ts-map-set, ts-unions, ts-symbols, ts-typeof-operator, ts-arrow-functions]
flags: [async]
---*/
// For-await over a Set through two interface implementations; node awaits promised duplicates while retaining Set-normalized positive zero and promised negative zero.
const log: string[] = [];
interface SetSource { values(): Set<number | Promise<number>>; }
class Stored implements SetSource {
  input: Set<number | Promise<number>>;
  constructor(input: Set<number | Promise<number>>) { this.input = input; }
  values(): Set<number | Promise<number>> { log.push("source"); return this.input; }
}
async function collect(source: SetSource): Promise<number[]> {
  const values: number[] = [];
  const iterator = source.values()[Symbol.iterator]();
  while (true) { const step = iterator.next(); if (step.done) { await step.value; break; }
    const value = await step.value; log.push("body:" + value); values.push(value); }
  log.push("after"); return values;
}
async function main(): Promise<void> {
  for (const input of [[], [-0], [-0, NaN, 3]]) {
    const set: Set<number | Promise<number>> = new Set(); const wanted: number[] = [];
    for (const value of input) { set.add(value); set.add(Promise.resolve(value)); wanted.push(value === 0 ? 0 : value, value); }
    const literal: SetSource = { values() { log.push("source"); return set; } };
    for (const source of [new Stored(set), literal]) {
      log.length = 0; const values = await collect(source); const expected = ["source"];
      for (const value of wanted) expected.push("body:" + value); expected.push("after");
      assert.compareArray(log, expected); assert.compareArray(values, wanted); assert.sameValue(set.size, input.length * 2);
      for (const value of values) assert.sameValue(typeof value, "number");
    }
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
