/*---
description: "For-await through readonly tuple source rows; node unwraps promised undefined, signed zero and object identities without dropping or copying values."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-interfaces, ts-unions, ts-tuples, ts-readonly, ts-typeof-operator, ts-type-aliases, ts-arrow-functions]
flags: [async]
---*/
// For-await through readonly tuple source rows; node unwraps promised undefined, signed zero and object identities without dropping or copying values.
const log: string[] = [];
interface Token { id: number; }
type Value = number | string | undefined | Token;
type Row = readonly [readonly (Value | Promise<Value>)[], readonly Value[]];
async function main(): Promise<void> {
  const token: Token = { id: 7 };
  const sources: readonly Row[] = [[[], []], [[Promise.resolve(undefined)], [undefined]], [[Promise.resolve(-0), token, Promise.resolve(token), "end"], [-0, token, token, "end"]]];
  for (const row of sources) {
    log.length = 0; const values: Value[] = [];
    for await (const value of row[0]) { log.push("body:" + typeof value); values.push(value); }
    log.push("after"); const expected: string[] = [];
    for (const value of row[1]) expected.push("body:" + typeof value); expected.push("after");
    assert.compareArray(log, expected); assert.compareArray(values, row[1]); assert.sameValue(values.length, row[0].length);
    for (let index = 0; index < values.length; index++) {
      assert.sameValue(Object.is(values[index], row[1][index]), true); assert.sameValue(typeof values[index], typeof row[1][index]);
    }
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
