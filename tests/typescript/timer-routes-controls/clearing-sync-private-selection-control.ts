/*---
description: "Canceling one private handle leaves the other instance timer active. The control uses direct callbacks."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-class, ts-class-fields, ts-this, ts-null-undefined, ts-unions, ts-private-fields]
flags: [async]
---*/
// Two instances retain separate private handles; node cancels only the selected instance and delivers the other value before the last sentinel. The control calls only the surviving callbacks.
const log: string[] = [];
class Slot {
  #handle: number | undefined; label: string;
  constructor(label: string) { this.label = label; log.push("new:" + label); }
  arm(callback: () => void, delay: number): void { log.push("arm:" + this.label); this.#handle = 0; }
  cancel(): void { log.push("clear:" + this.label); { const cleared = this.#handle; } }
}
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const cancelFirst of [false, true]) {
    log.length = 0; const first = new Slot("first"), second = new Slot("second"), seen: number[] = [], delay = 3;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const left = (): void => { log.push("first:" + value); seen.push(value); };
    const right = (): void => { log.push("second:" + value); seen.push(value * 10); };
    first.arm(left, delay); second.arm(right, delay); (cancelFirst ? first : second).cancel();
     log.push("sync"); await Promise.resolve(); if (cancelFirst) right(); else left(); sentinel(); await done; log.push("after");
    assert.compareArray(log, ["new:first", "new:second", "arm:first", "arm:second", cancelFirst ? "clear:first" : "clear:second", "sync", (cancelFirst ? "second:" : "first:") + value, "sentinel", "after"]);
    assert.compareArray(seen, [cancelFirst ? value * 10 : value]); assert.sameValue(seen.length, 1);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
