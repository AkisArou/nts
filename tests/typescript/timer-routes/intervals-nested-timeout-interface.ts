/*---
description: "An interval callback schedules an equal-delay timeout before its next repeat through a typed interface route; node preserves the exact callback log and count."
features: [ts-timer-routes, ts-timer-route-intervals, ts-async, ts-functions, ts-function-types, ts-arrays, ts-numbers, ts-unknown, ts-unions, ts-arrow-functions, ts-closures, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-interfaces]
flags: [async]
---*/
// An interval callback schedules an equal-delay timeout before its next repeat through a typed interface route; node preserves the exact callback log and count.
const log: string[] = [];
interface Store { store(handle: number): void; stop(): void; }
class PublicStore implements Store {
  handle: number | undefined;
  store(handle: number): void { this.handle = handle; }
  stop(): void { clearInterval(this.handle); }
}
class PrivateStore implements Store {
  #handle: number | undefined;
  store(handle: number): void { this.#handle = handle; }
  stop(): void { clearInterval(this.#handle); }
}
async function check(input: number, limit: number, route: Store): Promise<void> {
  log.length = 0;
  let count = 0; const seen: number[] = [];
  let offset = 0;
  const finished = new Promise<void>(resolve => {
    const tick: () => void = () => {
      count++; log.push("tick:" + count); seen.push(offset === 0 ? input : input + offset);
      if (count === 1) { setTimeout(() => { offset = 10; log.push("nested"); }, 2); }
      if (count === limit) { log.push("stop"); route.stop(); resolve(); }
    };
    route.store(setInterval(tick, 2));
    log.push("scheduled");
  });
  await finished;
  await new Promise<void>(resolve => { setTimeout(resolve, 8); });
  log.push("after"); const expected = ["scheduled"];
  const wanted: number[] = [];
  expected.push("tick:1", "nested", "tick:2", "stop", "after"); wanted.push(input, input + 10);
  assert.compareArray(log, expected); assert.compareArray(seen, wanted); assert.sameValue(count, limit);
}
async function main(): Promise<void> { for (const input of [-0, 7]) for (const limit of [2]) for (const route of [new PublicStore(), new PrivateStore()]) await check(input, limit, route); }
main().then(() => $DONE(), (error: unknown) => $DONE(error));
