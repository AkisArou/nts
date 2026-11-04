/*---
description: "Control: Breaking async array delegation through a generic consumer at two types; node runs and awaits outer cleanup even though the array has no return method."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-generics, ts-generic-constraints, ts-readonly, ts-unions, ts-symbols, ts-arrow-functions]
flags: [async]
---*/
// Breaking async array delegation through a generic consumer at two types; node runs and awaits outer cleanup even though the array has no return method.
const log: string[] = [];
async function collect<T extends number | string>(source: readonly (T | Promise<T>)[]): Promise<T[]> {
  const values: T[] = [];
  try {
    log.push("outer:start"); const iterator = source[Symbol.iterator](); const step = iterator.next();
    if (step.done) { await step.value; log.push("outer:complete"); }
    else { const value = await step.value; log.push("body:" + value); values.push(value); }
  } finally { log.push("outer:finally:start"); await Promise.resolve(); log.push("outer:finally:end"); }
  log.push("after"); return values;
}
async function check<T extends number | string>(input: T[]): Promise<void> {
  log.length = 0; const source: (T | Promise<T>)[] = []; for (const value of input) source.push(Promise.resolve(value));
  const values = await collect<T>(source); const expected = ["outer:start"];
  if (input.length) expected.push("body:" + input[0]); else expected.push("outer:complete");
  expected.push("outer:finally:start", "outer:finally:end", "after");
  assert.compareArray(log, expected); assert.compareArray(values, input.slice(0, 1)); assert.sameValue(source.length, input.length);
}
async function main(): Promise<void> {
  for (const input of [[], [-0], [1, 2, 3]]) await check<number>(input);
  for (const input of [[], [""], ["first", "second", "third"]]) await check<string>(input);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
