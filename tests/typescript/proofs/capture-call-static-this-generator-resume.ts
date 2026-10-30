/*---
description: A resumed inherited static generator writes the binding captured before it yielded.
features: [ts-proof-capture, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-function-types, ts-closures, ts-arrow-functions, ts-generators]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: resumption calls this.change with the saved writer; node reads the receiver-specific new value through the original closure.
class Base {
  static offset: number = 0;
  static change(write: (value: number) => void, n: number): void {}
  static *run(n: number): Generator<number, number, void> {
    let value = 10;
    const read = (): number => value;
    const write = (next: number): void => { value = next; };
    yield read();
    this.change(write, n);
    return read();
  }
}
class Write extends Base {
  static override offset: number = 30;
  static override change(write: (value: number) => void, n: number): void {
    if (n > 0) write(this.offset + n);
  }
}
class Further extends Write { static override offset: number = 50; }
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
  check(Write, n, n > 0 ? 30 + n : 10);
  check(Further, n, n > 0 ? 50 + n : 10);
}
