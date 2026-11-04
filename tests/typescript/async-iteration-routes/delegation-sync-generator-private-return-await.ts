/*---
description: "For-await through a private sync-generator field; node awaits the final promised completion after generator cleanup but excludes it from the loop values."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-generators, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-unions, ts-arrow-functions, ts-typeof-operator]
flags: [async]
---*/
// For-await through a private sync-generator field; node awaits the final promised completion after generator cleanup but excludes it from the loop values.
const log: string[] = [];
function* make(input: number[]): Generator<number | Promise<number>, Promise<string>, void> {
  try {
    for (let index = 0; index < input.length; index++) { log.push("yield:" + index); yield index % 2 ? input[index] : Promise.resolve(input[index]); }
    log.push("return"); return Promise.resolve("ignored").then(value => { log.push("return:awaited"); return value; });
  } finally { log.push("finally"); }
}
class Holder {
  #source: Generator<number | Promise<number>, Promise<string>, void>;
  constructor(input: number[]) { this.#source = make(input); }
  read(): Generator<number | Promise<number>, Promise<string>, void> { log.push("read"); return this.#source; }
}
async function main(): Promise<void> {
  for (const input of [[], [-0], [1, NaN, 3]]) {
    log.length = 0; const values: number[] = [], source = new Holder(input).read();
    for await (const value of source) { log.push("body:" + value); values.push(value); }
    log.push("after"); const expected = ["read"];
    for (let index = 0; index < input.length; index++) expected.push("yield:" + index, "body:" + input[index]);
    expected.push("return", "finally", "return:awaited", "after");
    assert.compareArray(log, expected); assert.compareArray(values, input); assert.sameValue(values.length, input.length);
    for (const value of values) assert.sameValue(typeof value, "number");
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
