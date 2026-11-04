/*---
description: "A hand throw through an object-literal factory enters the catch around the suspended yield; node yields recovery before finally and completion."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-errors, ts-type-aliases, ts-utility-types, ts-unknown, ts-objects, ts-async-generators, ts-generators]
flags: [async]
---*/
// A hand throw through an object-literal factory enters the catch around the suspended yield; node yields recovery before finally and completion.
const log: string[] = [];
type Cursor = Pick<AsyncGenerator<number, number | undefined, unknown>, "next" | "throw">;
async function* make(input: number, failure: Error): AsyncGenerator<number, number | undefined, unknown> {
  log.push("start"); try { log.push("yield"); yield input; log.push("normal"); }
  catch (error: unknown) { log.push(error === failure ? "catch" : "wrong"); yield input + 1; log.push("recovered"); }
  finally { log.push("finally"); } return input + 2;
}
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    log.length = 0; const failure = new RangeError("injected"), holder: { open(input: number, failure: Error): Cursor } = { open(input: number, failure: Error): Cursor { return make(input, failure); } };
    const source = holder.open(input, failure), first = await source.next(), recovered = await source.throw(failure), end = await source.next(), after = await source.next(); log.push("after");
    assert.compareArray([first.done, recovered.done, end.done, after.done], [false, false, true, true]);
    assert.compareArray([first.value, recovered.value, end.value, after.value], [input, input + 1, input + 2, undefined]);
    assert.compareArray(log, ["start", "yield", "catch", "recovered", "finally", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
