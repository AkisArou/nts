/*---
description: "For-await through a typed closure capturing an array source; node retains the acquired sync iterator while the body replaces the captured source binding."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-closures, ts-function-types, ts-arrow-functions, ts-readonly, ts-unions]
flags: [async]
---*/
// For-await through a typed closure capturing an array source; node retains the acquired sync iterator while the body replaces the captured source binding.
const log: string[] = [];
async function main(): Promise<void> {
  for (const input of [[], [-0], [1, 2, 3]]) {
    log.length = 0; const selected: (number | Promise<number>)[] = []; for (const value of input) selected.push(Promise.resolve(value));
    const replacement: readonly (number | Promise<number>)[] = [99]; let source: readonly (number | Promise<number>)[] = selected;
    const collect: () => Promise<number[]> = async () => {
      log.push("read"); const values: number[] = [];
      for await (const value of source) { log.push("body:" + value); values.push(value); source = replacement; log.push("replace"); }
      log.push("after"); return values;
    };
    const values = await collect(); const expected = ["read"];
    for (const value of input) expected.push("body:" + value, "replace"); expected.push("after");
    assert.compareArray(log, expected); assert.compareArray(values, input);
    assert.sameValue(source, input.length ? replacement : selected); assert.compareArray(replacement, [99]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
