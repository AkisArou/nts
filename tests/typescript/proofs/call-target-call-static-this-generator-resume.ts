/*---
description: A resumed static generator dispatches an instance replacement before calling its overridden reader.
features: [ts-proof-call-target, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-objects, ts-generators]
---*/
// Fact: a known receiver or closure permits a direct call (docs/foundations/objects.md, Calls).
// Route: the resumed this.change selects a new class and carries the actual static receiver offset into its result.
class Worker { read(): number { return 10; } }
class Special extends Worker {
  value: number;
  constructor(value: number) { super(); this.value = value; }
  override read(): number { return this.value; }
}
class Base {
  static offset: number = 0;
  static change(holder: { target: Worker }, n: number): void {}
  static *run(n: number): Generator<number, number, void> {
    const holder = { target: new Worker() };
    yield holder.target.read();
    this.change(holder, n);
    return holder.target.read();
  }
}
class Replace extends Base {
  static override offset: number = 200;
  static override change(holder: { target: Worker }, n: number): void {
    if (n > 0) holder.target = new Special(this.offset + n);
  }
}
class Further extends Replace { static override offset: number = 300; }
function check(Target: typeof Base, n: number, expected: number): void {
  const steps = Target.run(n), before = steps.next();
  assert.sameValue(before.done, false);
  assert.sameValue(before.value, 10);
  const after = steps.next();
  assert.sameValue(after.done, true);
  assert.sameValue(after.value, expected);
}
for (const n of [-1, 0, 1, 3, 7]) {
  check(Base, n, 10);
  check(Replace, n, n > 0 ? 200 + n : 10);
  check(Further, n, n > 0 ? 300 + n : 10);
}
