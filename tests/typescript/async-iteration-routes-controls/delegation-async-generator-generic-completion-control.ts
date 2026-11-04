/*---
description: "Control: Async yield delegation through a generic consumer; node awaits inner yields and completion, retains signed zero or text, then resumes the outer body."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-generators, ts-generics, ts-generic-constraints, ts-unions, ts-symbols, ts-typeof-operator, ts-arrow-functions]
flags: [async]
---*/
// Async yield delegation through a generic consumer; node awaits inner yields and completion, retains signed zero or text, then resumes the outer body.
const log: string[] = [];
function adapt<T, R>(inner: Iterator<T | Promise<T>, R | Promise<R>, void>): AsyncIterableIterator<T, R, void> {
  return { [Symbol.asyncIterator]() { return this; }, async next(): Promise<IteratorResult<T, R>> {
    const step = inner.next();
    return step.done ? { value: await step.value, done: true } : { value: await step.value, done: false };
  } };
}

function produce<T extends number | string>(input: T[], result: T): AsyncIterableIterator<T, T, void> {
  return adapt((function* (): Generator<T | Promise<T>, T | Promise<T>, void> {
  try { for (const value of input) { log.push("inner:" + value); yield Promise.resolve(value); } log.push("inner:return"); return Promise.resolve(result); }
  finally { log.push("inner:finally"); }
  })());
}
async function collect<T extends number | string>(source: AsyncIterable<T, T, void>): Promise<T[]> {
  const values: T[] = [];
  log.push("outer:start"); const iterator = source[Symbol.asyncIterator]();
  while (true) {
    const step = await iterator.next();
    if (step.done) { const result = step.value; log.push("outer:completion"); values.push(result); break; }
    const value = await step.value; log.push("body:" + value); values.push(value);
  }
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
