/*---
description: "A hand rejected-return before the first next crosses a tuple route; node finishes without entering the generator body or finally."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-errors, ts-type-aliases, ts-utility-types, ts-unknown, ts-tuples, ts-instanceof, ts-async-generators, ts-generators]
flags: [async]
---*/
// A hand rejected-return before the first next crosses a tuple route; node finishes without entering the generator body or finally.
const log: string[] = [];
type Cursor = Pick<AsyncGenerator<number, number | undefined, unknown>, "next" | "return">;
async function* make(input: number): AsyncGenerator<number, number | undefined, unknown> {
  log.push("body"); try { yield input; } finally { log.push("finally"); } return undefined;
}

async function run(): Promise<void> {
  for (const input of [3, 7]) {
    log.length = 0; const tuple: [Cursor] = [make(input)]; const source = tuple[0];
    const failure = new URIError("stop"); let caught: unknown; try { await source.return(Promise.reject(failure)); } catch (error: unknown) { caught = error; log.push("catch"); }
    assert.sameValue(caught, failure); assert.sameValue(caught instanceof URIError, true);
    const after = await source.next(); log.push("after"); assert.sameValue(after.done, true); assert.sameValue(after.value, undefined);
    assert.compareArray(log, ["catch", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
