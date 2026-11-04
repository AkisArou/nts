/*---
description: "Control: An interval clears itself at the selected count through a typed static route; node preserves the exact callback log and count."
features: [ts-timer-routes, ts-timer-route-intervals, ts-async, ts-functions, ts-function-types, ts-arrays, ts-numbers, ts-unknown, ts-unions, ts-arrow-functions, ts-closures, ts-class, ts-class-fields, ts-static]
flags: [async]
---*/
// An interval clears itself at the selected count through a typed static route; node preserves the exact callback log and count.
const log: string[] = [];
function forget(handle: number | undefined): void {}
class Slot { static handle: number | undefined; }
async function check(input: number, limit: number): Promise<void> {
  log.length = 0; Slot.handle = undefined;
  let count = 0; const seen: number[] = [];
  let invoke: () => void = () => {};
  const finished = new Promise<void>(resolve => {
    const tick: () => void = () => {
      count++; log.push("tick:" + count); seen.push(input);
      if (count === limit) { log.push("stop"); forget(Slot.handle); resolve(); }
    };
    Slot.handle = 0;
    invoke = tick;
    log.push("scheduled");
  });
  for (let index = 0; index < limit; index++) invoke();
  await finished;
  await Promise.resolve();
  log.push("after"); const expected = ["scheduled"];
  const wanted: number[] = [];
  for (let index = 1; index <= limit; index++) { expected.push("tick:" + index); wanted.push(input); }
  expected.push("stop", "after");
  assert.compareArray(log, expected); assert.compareArray(seen, wanted); assert.sameValue(count, limit);
}
async function main(): Promise<void> { for (const input of [-0, 7]) for (const limit of [1, 3]) await check(input, limit); }
main().then(() => $DONE(), (error: unknown) => $DONE(error));
