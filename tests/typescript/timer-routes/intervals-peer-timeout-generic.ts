/*---
description: "An interval and an equal-delay timeout are created together through a typed generic route; node preserves the exact callback log and count."
features: [ts-timer-routes, ts-timer-route-intervals, ts-async, ts-functions, ts-function-types, ts-arrays, ts-numbers, ts-unknown, ts-unions, ts-arrow-functions, ts-closures, ts-generics, ts-strings]
flags: [async]
---*/
// An interval and an equal-delay timeout are created together through a typed generic route; node preserves the exact callback log and count.
const log: string[] = [];
function begin<T>(value: T, sink: (value: T) => void): number { return setInterval(() => sink(value), 2); }
async function check<T>(input: T, limit: number): Promise<void> {
  log.length = 0; let handle: number | undefined;
  let count = 0; const seen: T[] = [];
  const peer: () => void = () => { log.push("timeout"); };
  const finished = new Promise<void>(resolve => {
    const tick: (value: T) => void = (value: T) => {
      count++; log.push("tick:" + count); seen.push(value);
      if (count === limit) { log.push("stop"); clearInterval(handle); resolve(); }
    };
    handle = begin<T>(input, tick);
    setTimeout(peer, 2);
    log.push("scheduled");
  });
  await finished;
  await new Promise<void>(resolve => { setTimeout(resolve, 8); });
  log.push("after"); const expected = ["scheduled"];
  const wanted: T[] = [];
  expected.push("tick:1", "timeout", "tick:2", "stop", "after"); wanted.push(input, input);
  assert.compareArray(log, expected); assert.compareArray(seen, wanted); assert.sameValue(count, limit);
}
async function main(): Promise<void> {
  for (const input of [-0, 7]) for (const limit of [2]) await check<number>(input, limit);
  for (const input of ["", "value"]) for (const limit of [2]) await check<string>(input, limit);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
