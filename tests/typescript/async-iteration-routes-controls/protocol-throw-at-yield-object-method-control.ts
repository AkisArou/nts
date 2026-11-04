/*---
description: "Control: A hand throw through an object-literal factory enters the catch around the suspended yield; node yields recovery before finally and completion."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-errors, ts-type-aliases, ts-utility-types, ts-unknown, ts-objects, ts-class, ts-class-fields, ts-this]
flags: [async]
---*/
// A hand throw through an object-literal factory enters the catch around the suspended yield; node yields recovery before finally and completion.
const log: string[] = [];
type Cursor = Pick<AsyncGenerator<number, number | undefined, unknown>, "next" | "throw">;
class Recovering {
  input: number; failure: Error; state = 0; constructor(input: number, failure: Error) { this.input = input; this.failure = failure; }
  async next(): Promise<IteratorResult<number, number | undefined>> {
    if (this.state === 0) { this.state = 1; log.push("start"); log.push("yield"); return { value: this.input, done: false }; }
    if (this.state === 2) { this.state = 3; log.push("recovered"); log.push("finally"); return { value: this.input + 2, done: true }; }
    return { value: undefined, done: true };
  }
  async throw(error: unknown): Promise<IteratorResult<number, number | undefined>> { this.state = 2; log.push(error === this.failure ? "catch" : "wrong"); return { value: this.input + 1, done: false }; }
}
function make(input: number, failure: Error): Cursor { return new Recovering(input, failure); }
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
