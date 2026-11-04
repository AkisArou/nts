/*---
description: "For-await through a generic mixed-value array; node awaits every value at two types and observes a promised tail appended by the first body step."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-generics, ts-generic-constraints, ts-unions, ts-typeof-operator, ts-arrow-functions]
flags: [async]
---*/
// For-await through a generic mixed-value array; node awaits every value at two types and observes a promised tail appended by the first body step.
const log: string[] = [];
async function collect<T extends number | string>(source: (T | Promise<T>)[], tail: T): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) {
    log.push("body:" + value); values.push(value);
    if (values.length === 1) { source.push(Promise.resolve(tail)); log.push("append"); }
  }
  log.push("after"); return values;
}
async function check<T extends number | string>(input: T[], tail: T): Promise<void> {
  log.length = 0; const source: (T | Promise<T>)[] = [];
  for (let index = 0; index < input.length; index++) source.push(index % 2 ? input[index] : Promise.resolve(input[index]));
  const values = await collect<T>(source, tail); const wanted = input.length ? [...input, tail] : []; const expected: string[] = [];
  for (let index = 0; index < wanted.length; index++) { expected.push("body:" + wanted[index]); if (index === 0) expected.push("append"); } expected.push("after");
  assert.compareArray(log, expected); assert.compareArray(values, wanted); assert.sameValue(source.length, wanted.length);
  for (let index = 0; index < values.length; index++) assert.sameValue(typeof values[index], typeof wanted[index]);
}
async function main(): Promise<void> {
  for (const input of [[], [-0], [1, NaN, 3]]) await check<number>(input, -0);
  for (const input of [[], [""], ["first", "second", "third"]]) await check<string>(input, "tail");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
