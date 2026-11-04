/*---
description: "For-await through a sync generator object method; node resumes each receiver read only after the preceding awaited body writes the receiver scale."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-generators, ts-objects, ts-this, ts-unions, ts-arrow-functions]
flags: [async]
---*/
// For-await through a sync generator object method; node resumes each receiver read only after the preceding awaited body writes the receiver scale.
const log: string[] = [];
const producer = {
  scale: 1,
  *values(input: number[]): Generator<number | Promise<number>, void, void> {
    try { for (let index = 0; index < input.length; index++) {
      const value = input[index] * this.scale; log.push("yield:" + value); yield index % 2 ? value : Promise.resolve(value);
    } } finally { log.push("finally:" + this.scale); }
  }
};
async function main(): Promise<void> {
  for (const input of [[], [-0], [2, 3, 4]]) {
    log.length = 0; producer.scale = 1; const values: number[] = [];
    for await (const value of producer.values(input)) { log.push("body:" + value); values.push(value); producer.scale++; log.push("write:" + producer.scale); }
    log.push("after"); const wanted: number[] = [], expected: string[] = [];
    for (let index = 0; index < input.length; index++) { const value = input[index] * (index + 1); wanted.push(value); expected.push("yield:" + value, "body:" + value, "write:" + (index + 2)); }
    expected.push("finally:" + (input.length + 1), "after");
    assert.compareArray(log, expected); assert.compareArray(values, wanted); assert.sameValue(producer.scale, input.length + 1);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
