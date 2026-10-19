/*---
description: An interface with a construct signature types a class value that a factory constructs.
features: [ts-interfaces, ts-construct-signatures, ts-class]
---*/
interface Clock {
  tick(): number;
}
interface ClockConstructor {
  new (start: number): Clock;
}
class StepClock implements Clock {
  constructor(private now: number) {}
  tick(): number {
    return ++this.now;
  }
}
function build(ctor: ClockConstructor, start: number): Clock {
  return new ctor(start);
}
const clock = build(StepClock, 10);
clock.tick();
assert.sameValue(clock.tick(), 12);
assert.sameValue(clock instanceof StepClock, true);
