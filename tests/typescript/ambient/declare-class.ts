/*---
description: A `declare class` emits nothing; `new` constructs whatever class the global binding holds at run time.
features: [ts-ambient, ts-class]
---*/
declare class HostTimer {
  constructor(start: number);
  elapsed(): number;
}
(globalThis as { HostTimer?: unknown }).HostTimer = class {
  constructor(private start: number) {}
  elapsed(): number {
    return 100 - this.start;
  }
};
const timer = new HostTimer(40);
assert.sameValue(timer.elapsed(), 60);
assert.sameValue(timer instanceof HostTimer, true);
