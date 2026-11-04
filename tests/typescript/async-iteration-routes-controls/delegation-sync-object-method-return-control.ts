/*---
description: "Control: Returning from an object-method consumer during async delegation to a sync generator; node closes inner then outer before consumer cleanup and delivery."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-generators, ts-objects, ts-this, ts-unions, ts-typeof-operator, ts-arrow-functions]
flags: [async]
---*/
// Returning from an object-method consumer during async delegation to a sync generator; node closes inner then outer before consumer cleanup and delivery.
const log: string[] = [];
const reader = {
  *source(input: number[]): Generator<number | Promise<number>, void, void> {
    try { for (const value of input) { log.push("inner:" + value); yield Promise.resolve(value); } }
    finally { log.push("inner:finally"); }
  },
  async take(input: number[]): Promise<number | undefined> {
    const source = this.source(input);
    try {
      try {
        log.push("outer:start"); const step = source.next();
        if (!step.done) { const value = await step.value; log.push("body:" + value); await source.return(undefined).value; return value; }
        await step.value;
      } finally { log.push("outer:finally"); }
      log.push("empty"); return undefined;
    } finally { log.push("consumer:finally"); }
  }
};
async function main(): Promise<void> {
  for (const input of [[], [-0], [4, 5, 6]]) {
    log.length = 0; const result = await reader.take(input); log.push("after"); const expected = ["outer:start"];
    if (input.length) expected.push("inner:" + input[0], "body:" + input[0]); expected.push("inner:finally", "outer:finally");
    if (!input.length) expected.push("empty"); expected.push("consumer:finally", "after");
    assert.compareArray(log, expected); assert.sameValue(Object.is(result, input[0]), true);
    assert.sameValue(typeof result, input.length ? "number" : "undefined");
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
