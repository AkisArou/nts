/*---
description: A generic constructor return keeps base private state available while a derived private field is still absent.
features: [ts-private-member-routes, ts-private-member-route-inheritance, ts-class, ts-class-fields, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-generics, ts-generic-constraints, ts-inheritance, ts-override, ts-functions, ts-unknown, ts-instanceof, ts-private-fields]
---*/
// HookBase instances return from a generic constructor helper; node reads the initialized base slot during the hook, then finds the derived brand only after super returns.
class HookBase {
  #value: number;
  constructor(value: number, log: unknown[]) { this.#value = value; this.observe(log); }
  observe(log: unknown[]): void { log.push(this.#value); }
  read(): unknown { return this.#value; }
  static owns(value: object): boolean { return #value in value; }
}
class HookChild extends HookBase {
  #ready: boolean = true;
  override observe(log: unknown[]): void { super.observe(log); log.push(#ready in this); }
  ready(): unknown { return this.#ready; }
  static readyBrand(value: object): boolean { return #ready in value; }
}
function construct<T extends HookBase>(ctor: new (value: number, log: unknown[]) => T, value: number, log: unknown[]): T { return new ctor(value, log); }
const constructors: { ctor: new (value: number, log: unknown[]) => HookBase; child: boolean }[] = [{ ctor: HookChild, child: true }, { ctor: HookBase, child: false }, { ctor: HookChild, child: true }];
for (const value of [-0, 3, 17]) for (const entry of constructors) {
  const log: unknown[] = [], instance: HookBase = construct(entry.ctor, value, log);
  assert.compareArray(log, entry.child ? [value, false] : [value]);
  assert.sameValue(instance.read(), value); assert.sameValue(HookBase.owns(instance), true);
  assert.sameValue(HookChild.readyBrand(instance), entry.child);
  if (instance instanceof HookChild) assert.sameValue(instance.ready(), true);
  assert.sameValue(HookBase.owns({}), false); assert.sameValue(HookChild.readyBrand({}), false);
}
