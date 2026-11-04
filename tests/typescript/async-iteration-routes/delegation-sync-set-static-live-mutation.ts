/*---
description: "For-await through a static Set consumer; node waits for each value and observes body deletion of an unvisited entry and insertion of a promised tail."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-class, ts-static, ts-map-set, ts-unions, ts-typeof-operator, ts-arrow-functions]
flags: [async]
---*/
// For-await through a static Set consumer; node waits for each value and observes body deletion of an unvisited entry and insertion of a promised tail.
const log: string[] = [];
class Reader {
  static async collect(source: Set<number | Promise<number>>): Promise<number[]> {
    const values: number[] = [];
    for await (const value of source) {
      log.push("body:" + value); values.push(value);
      if (values.length === 1) { source.delete(3); source.add(Promise.resolve(4)); log.push("mutate"); }
    }
    log.push("after"); return values;
  }
}
async function main(): Promise<void> {
  for (const input of [[], [1], [1, 2, 3]]) {
    log.length = 0; const source: Set<number | Promise<number>> = new Set();
    for (const value of input) source.add(value === 2 ? Promise.resolve(value) : value);
    const values = await Reader.collect(source); const wanted = input.length === 0 ? [] : input.length === 1 ? [1, 4] : [1, 2, 4]; const expected: string[] = [];
    for (let index = 0; index < wanted.length; index++) { expected.push("body:" + wanted[index]); if (index === 0) expected.push("mutate"); } expected.push("after");
    assert.compareArray(log, expected); assert.compareArray(values, wanted); assert.sameValue(source.size, wanted.length);
    assert.sameValue(source.has(3), false); for (const value of values) assert.sameValue(typeof value, "number");
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
