/*---
description: A compound-assignment operand dispatches a static override that writes an already-read captured binding.
features: [ts-proof-capture, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-function-types, ts-closures, ts-arrow-functions, ts-objects]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: this.change invokes the captured writer; node retains the actual subclass offset in the reader made before that call.
class Base {
  static offset: number = 0;
  static change(write: (value: number) => void, n: number): number { return 0; }
  static run(n: number) {
    let value = 10;
    const read = (): number => value;
    const write = (next: number): void => { value = next; };
    const before = read();
    let changed = 0;
    changed += this.change(write, n);
    return { before, after: read(), changed };
  }
}
class Write extends Base {
  static override offset: number = 30;
  static override change(write: (value: number) => void, n: number): number {
    if (n <= 0) return 0;
    write(this.offset + n);
    return 1;
  }
}
class Further extends Write { static override offset: number = 50; }
function check(Target: typeof Base, n: number, expected: number, changed: number): void {
  const result = Target.run(n);
  assert.sameValue(result.before, 10);
  assert.sameValue(result.after, expected);
  assert.sameValue(result.changed, changed);
}
for (const n of [-1, 0, 1, 3, 7]) {
  check(Base, n, 10, 0);
  check(Write, n, n > 0 ? 30 + n : 10, n > 0 ? 1 : 0);
  check(Further, n, n > 0 ? 50 + n : 10, n > 0 ? 1 : 0);
}
