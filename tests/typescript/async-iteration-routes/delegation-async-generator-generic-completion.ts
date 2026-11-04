/*---
description: "Async yield delegation through a generic consumer; node awaits inner yields and completion, retains signed zero or text, then resumes the outer body."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-generators, ts-generics, ts-generic-constraints, ts-unions, ts-typeof-operator, ts-arrow-functions]
flags: [async]
---*/
// Async yield delegation through a generic consumer; node awaits inner yields and completion, retains signed zero or text, then resumes the outer body.
const log: string[] = [];
async function* produce<T extends number | string>(input: T[], result: T): AsyncIterableIterator<T, T, void> {
  try { for (const value of input) { log.push("inner:" + value); yield Promise.resolve(value); } log.push("inner:return"); return Promise.resolve(result); }
  finally { log.push("inner:finally"); }
}
async function collect<T extends number | string>(source: AsyncIterable<T, T, void>): Promise<T[]> {
  const values: T[] = [];
  async function* outer(): AsyncIterableIterator<T, void, void> {
    log.push("outer:start"); const result = yield* source; log.push("outer:completion"); values.push(result);
  }
  for await (const value of outer()) { log.push("body:" + value); values.push(value); }
  log.push("after"); return values;
}
async function check<T extends number | string>(input: T[], result: T): Promise<void> {
  log.length = 0;
  const values = await collect<T>(produce(input, result));
  const expected = ["outer:start"]; for (const value of input) expected.push("inner:" + value, "body:" + value);
  expected.push("inner:return", "inner:finally", "outer:completion", "after");
  assert.compareArray(log, expected); assert.compareArray(values, [...input, result]);
  assert.sameValue(typeof values[values.length - 1], typeof result);
}
async function main(): Promise<void> {
  for (const input of [[], [-0], [NaN, 2, -0]]) await check<number>(input, -0);
  for (const input of [[], [""], ["first", "\u4e2d", "last"]]) await check<string>(input, "done");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
