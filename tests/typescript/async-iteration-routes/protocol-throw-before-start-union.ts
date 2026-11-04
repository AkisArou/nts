/*---
description: "A hand throw before the first next crosses a union route; node finishes without entering the generator body or finally."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-errors, ts-type-aliases, ts-utility-types, ts-unknown, ts-unions, ts-objects, ts-arrow-functions, ts-instanceof, ts-async-generators, ts-generators]
flags: [async]
---*/
// A hand throw before the first next crosses a union route; node finishes without entering the generator body or finally.
const log: string[] = [];
type Cursor = Pick<AsyncGenerator<number, number | undefined, unknown>, "next" | "throw">;
async function* make(input: number): AsyncGenerator<number, number | undefined, unknown> {
  log.push("body"); try { yield input; } finally { log.push("finally"); } return undefined;
}
type Choice = { kind: "direct"; source: Cursor } | { kind: "factory"; open: () => Cursor };
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    log.length = 0; const choice: Choice = input === 3 ? { kind: "direct", source: make(input) } : { kind: "factory", open: () => make(input) }; const source = choice.kind === "direct" ? choice.source : choice.open();
    const failure = new URIError("stop"); let caught: unknown; try { await source.throw(failure); } catch (error: unknown) { caught = error; log.push("catch"); }
    assert.sameValue(caught, failure); assert.sameValue(caught instanceof URIError, true);
    const after = await source.next(); log.push("after"); assert.sameValue(after.done, true); assert.sameValue(after.value, undefined);
    assert.compareArray(log, ["catch", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
