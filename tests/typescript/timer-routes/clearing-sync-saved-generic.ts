/*---
description: "A saved handle cancels the old generic job after the current job is replaced."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-generics, ts-type-aliases, ts-objects, ts-typeof-operator]
flags: [async]
---*/
// A generic job stores a callback and handle; node cancels the saved old job while preserving the replacement number or string, including negative zero.
const log: string[] = [];
type Job<T> = { value: T; callback: () => void; handle: number };
function schedule<T>(value: T, delay: number, sink: (value: T) => void): Job<T> {
  log.push("schedule:" + String(value)); const callback = (): void => { log.push("fire:" + String(value)); sink(value); };
  const handle = setTimeout(callback, delay); return { value, callback, handle };
}
async function check<T>(first: T, second: T, kind: string, delay: number): Promise<void> {
  log.length = 0; const seen: T[] = [];
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const sentinel = (): void => { log.push("sentinel"); finish(); };
  const sink = (value: T): void => { seen.push(value); log.push("sink:" + String(value)); };
  let job = schedule<T>(first, delay, sink); const saved: number = job.handle; job = schedule<T>(second, delay, sink);
  log.push("clear-old"); clearTimeout(saved); setTimeout(sentinel, delay); log.push("sync"); await done; log.push("after");
  assert.compareArray(log, ["schedule:" + String(first), "schedule:" + String(second), "clear-old", "sync", "fire:" + String(second), "sink:" + String(second), "sentinel", "after"]);
  assert.compareArray(seen, [second]); assert.sameValue(seen[0], second); assert.sameValue(typeof seen[0], kind); assert.sameValue(job.value, second);
}
async function main(): Promise<void> { for (const delay of [1, 4]) { await check<number>(-0, 1.5, "number", delay); await check<number>(1.5, -0, "number", delay); await check<string>("before", "after", "string", delay); } }
main().then(() => $DONE(), (error: unknown) => $DONE(error));
