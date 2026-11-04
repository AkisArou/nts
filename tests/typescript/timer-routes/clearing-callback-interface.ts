/*---
description: "Timer-driven cancellation dispatches through public-field and private-field interface implementations."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-class, ts-class-fields, ts-this, ts-null-undefined, ts-unions, ts-errors, ts-interfaces, ts-private-fields]
flags: [async]
---*/
// One Pending interface carries two timer-based classes; node dispatches cancellation to the chosen class and omits its target before the surviving sentinel.
const log: string[] = [];
interface Pending { label: string; start(callback: () => void, delay: number): void; cancel(): void; }
class PublicJob implements Pending {
  label: string = "public"; handle: number | undefined;
  start(callback: () => void, delay: number): void { log.push("arm:public"); this.handle = setTimeout(callback, delay); }
  cancel(): void { log.push("clear:public"); clearTimeout(this.handle); }
}
class PrivateJob implements Pending {
  label: string = "private"; #handle: number | undefined;
  start(callback: () => void, delay: number): void { log.push("arm:private"); this.#handle = setTimeout(callback, delay); }
  cancel(): void { log.push("clear:private"); clearTimeout(this.#handle); }
}
async function main(): Promise<void> {
  const jobs: Pending[] = [new PublicJob(), new PrivateJob()];
  for (const job of jobs) for (const value of [2, 7]) {
    log.length = 0; const seen: number[] = [], delay = 3; let fault: unknown;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const target = (): void => { log.push("target:" + value); seen.push(value); };
    const survivor = (): void => { log.push("survivor:" + value); seen.push(value + 1); };
    const controller = (): void => { log.push("controller"); try { job.cancel(); } catch (error: unknown) { fault = error; log.push("caught"); } };
    setTimeout(controller, delay); job.start(target, delay); setTimeout(survivor, delay); setTimeout(sentinel, delay); log.push("sync");
    await done; log.push("after");
    assert.compareArray(log, ["arm:" + job.label, "sync", "controller", "clear:" + job.label, "survivor:" + value, "sentinel", "after"]);
    assert.compareArray(seen, [value + 1]); assert.sameValue(fault, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
