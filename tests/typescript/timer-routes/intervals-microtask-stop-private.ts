/*---
description: "A microtask clears an interval after its first callback through a typed private route; node preserves the exact callback log and count."
features: [ts-timer-routes, ts-timer-route-intervals, ts-async, ts-functions, ts-function-types, ts-arrays, ts-numbers, ts-unknown, ts-unions, ts-arrow-functions, ts-closures, ts-class, ts-class-fields, ts-private-fields, ts-this]
flags: [async]
---*/
// A microtask clears an interval after its first callback through a typed private route; node preserves the exact callback log and count.
const log: string[] = [];
class Slot {
  #handle: number | undefined;
  store(handle: number): void { this.#handle = handle; }
  stop(): void { clearInterval(this.#handle); }
}
async function check(input: number, limit: number): Promise<void> {
  log.length = 0; const route = new Slot();
  let count = 0; const seen: number[] = [];
  const finished = new Promise<void>(resolve => {
    const tick: () => void = () => {
      count++; log.push("tick:" + count); seen.push(input);
      if (count === limit) Promise.resolve().then(() => { log.push("stop"); route.stop(); resolve(); });
    };
    route.store(setInterval(tick, 2));
    log.push("scheduled");
  });
  await finished;
  await new Promise<void>(resolve => { setTimeout(resolve, 8); });
  log.push("after"); const expected = ["scheduled"];
  const wanted: number[] = [];
  for (let index = 1; index <= limit; index++) { expected.push("tick:" + index); wanted.push(input); }
  expected.push("stop", "after");
  assert.compareArray(log, expected); assert.compareArray(seen, wanted); assert.sameValue(count, limit);
}
async function main(): Promise<void> { for (const input of [-0, 7]) for (const limit of [1]) await check(input, limit); }
main().then(() => $DONE(), (error: unknown) => $DONE(error));
