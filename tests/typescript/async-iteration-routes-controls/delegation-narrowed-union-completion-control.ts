/*---
description: "Control: Async yield delegation through a discriminated async-or-sync union; node selects the protocol and retains the same awaited negative-zero completion."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-generators, ts-unions, ts-narrowing, ts-symbols, ts-generics, ts-type-aliases, ts-arrow-functions]
flags: [async]
---*/
// Async yield delegation through a discriminated async-or-sync union; node selects the protocol and retains the same awaited negative-zero completion.
const log: string[] = [];
function adapt<T, R>(inner: Iterator<T | Promise<T>, R | Promise<R>, void>): AsyncIterableIterator<T, R, void> {
  return { [Symbol.asyncIterator]() { return this; }, async next(): Promise<IteratorResult<T, R>> {
    const step = inner.next();
    return step.done ? { value: await step.value, done: true } : { value: await step.value, done: false };
  } };
}

type Route = { kind: "async"; source: AsyncIterable<number, number, void> } | { kind: "sync"; source: Iterable<number | Promise<number>, Promise<number>, void> };
function asynchronous(input: number[]): AsyncIterableIterator<number, number, void> { return adapt(synchronous(input)); }
function* synchronous(input: number[]): Generator<number | Promise<number>, Promise<number>, void> {
  for (const value of input) { log.push("inner:" + value); yield Promise.resolve(value); } log.push("return"); return Promise.resolve(-0);
}
async function collect(route: Route): Promise<number[]> {
  const values: number[] = [];
  log.push(route.kind);
  const iterator = route.kind === "async" ? route.source[Symbol.asyncIterator]() : route.source[Symbol.iterator]();
  while (true) { const step = await iterator.next(); const value = await step.value;
    if (step.done) { const result = value; log.push("completion"); values.push(result); break; }
    log.push("body:" + value); values.push(value); }
  log.push("after"); return values;
}
async function main(): Promise<void> {
  for (const input of [[], [1], [2, -0, 4]]) {
    const routes: Route[] = [{ kind: "async", source: asynchronous(input) }, { kind: "sync", source: synchronous(input) }];
    for (const route of routes) {
      log.length = 0; const values = await collect(route); const expected: string[] = [route.kind];
      for (const value of input) expected.push("inner:" + value, "body:" + value); expected.push("return", "completion", "after");
      assert.compareArray(log, expected); assert.compareArray(values, [...input, -0]);
      assert.sameValue(Object.is(values[values.length - 1], -0), true);
    }
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
