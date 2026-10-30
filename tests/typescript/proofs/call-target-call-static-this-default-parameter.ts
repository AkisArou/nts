/*---
description: A default-parameter static call replaces the known instance used by a later overridden method call.
features: [ts-proof-call-target, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-objects, ts-default-parameters]
---*/
// Fact: a known receiver or closure permits a direct call (docs/foundations/objects.md, Calls).
// Route: the default dispatches this.change; node invokes the replacement instance with the actual static receiver offset.
class Worker { read(): number { return 10; } }
class Special extends Worker {
  value: number;
  constructor(value: number) { super(); this.value = value; }
  override read(): number { return this.value; }
}
class Base {
  static offset: number = 0;
  static change(holder: { target: Worker }, n: number): number { return 0; }
  static execute(holder: { target: Worker }, n: number, changed = this.change(holder, n)): number { return changed; }
  static run(n: number, supplied: boolean): number {
    const holder = { target: new Worker() };
    this.execute(holder, n, supplied ? 0 : undefined);
    return holder.target.read();
  }
}
class Replace extends Base {
  static override offset: number = 200;
  static override change(holder: { target: Worker }, n: number): number {
    if (n > 0) holder.target = new Special(this.offset + n);
    return 0;
  }
}
class Further extends Replace { static override offset: number = 300; }
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(Base.run(n, false), 10);
  assert.sameValue(Replace.run(n, false), n > 0 ? 200 + n : 10);
  assert.sameValue(Further.run(n, false), n > 0 ? 300 + n : 10);
  assert.sameValue(Further.run(n, true), 10);
}
