/*---
description: "Control: Async yield delegation through a private generator method; node awaits the synchronous completion promise before resuming the outer body."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-generators, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-unions, ts-arrow-functions]
flags: [async]
---*/
// Async yield delegation through a private generator method; node awaits the synchronous completion promise before resuming the outer body.
const log: string[] = [];
class SourceBox {
  #input: number[];
  constructor(input: number[]) { this.#input = input; }
  *#source(result: number): Generator<number | Promise<number>, Promise<number>, void> {
    try { for (const value of this.#input) { log.push("inner:" + value); yield Promise.resolve(value); } log.push("inner:return"); return Promise.resolve(result); }
    finally { log.push("inner:finally"); }
  }
  async collect(result: number): Promise<number[]> {
    const values: number[] = []; const source = this.#source(result);
    log.push("outer:start");
    while (true) {
      const step = source.next(); const value = await step.value;
      if (step.done) { const completion = value; log.push("outer:completion"); values.push(completion); break; }
      log.push("body:" + value); values.push(value);
    }
    log.push("after"); return values;
  }
}
async function main(): Promise<void> {
  for (const input of [[], [1], [-0, NaN, 4]]) for (const result of [-0, 9]) {
    log.length = 0; const values = await new SourceBox(input).collect(result);
    const expected = ["outer:start"]; for (const value of input) expected.push("inner:" + value, "body:" + value);
    expected.push("inner:return", "inner:finally", "outer:completion", "after");
    assert.compareArray(log, expected); assert.compareArray(values, [...input, result]);
    assert.sameValue(Object.is(values[values.length - 1], result), true);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
