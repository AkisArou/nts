/*---
description: "An interval-created equal-delay timeout clears the interval at the selected count through a typed generic route; node preserves the exact callback log and count."
features: [ts-timer-routes, ts-timer-route-intervals, ts-async, ts-functions, ts-function-types, ts-arrays, ts-numbers, ts-unknown, ts-unions, ts-arrow-functions, ts-closures, ts-generics, ts-strings]
flags: [async]
---*/
// An interval-created equal-delay timeout clears the interval at the selected count through a typed generic route; node preserves the exact callback log and count.
const log: string[] = [];
function begin<T>(value: T, sink: (value: T) => void): number { return setInterval(() => sink(value), 2); }
async function check<T>(input: T, limit: number): Promise<void> {
  log.length = 0; let handle: number | undefined;
  let count = 0; const seen: T[] = [];
  const finished = new Promise<void>(resolve => {
    const tick: (value: T) => void = (value: T) => {
      count++; log.push("tick:" + count); seen.push(value);
      if (count === limit) { setTimeout(() => { log.push("stop"); clearInterval(handle); resolve(); }, 2); }
    };
    handle = begin<T>(input, tick);
    log.push("scheduled");
  });
  await finished;
  await new Promise<void>(resolve => { setTimeout(resolve, 8); });
  log.push("after"); const expected = ["scheduled"];
  const wanted: T[] = [];
  for (let index = 1; index <= limit; index++) { expected.push("tick:" + index); wanted.push(input); }
  expected.push("stop", "after");
  assert.compareArray(log, expected); assert.compareArray(seen, wanted); assert.sameValue(count, limit);
}
async function main(): Promise<void> {
  for (const input of [-0, 7]) for (const limit of [1, 3]) await check<number>(input, limit);
  for (const input of ["", "value"]) for (const limit of [1, 3]) await check<string>(input, limit);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
