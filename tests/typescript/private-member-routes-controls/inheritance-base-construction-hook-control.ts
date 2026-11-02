/*---
description: A Map-backed control: A generic constructor return keeps base private state available while a derived private field is still absent.
features: [ts-private-member-routes, ts-private-member-route-inheritance, ts-class, ts-class-fields, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-generics, ts-generic-constraints, ts-inheritance, ts-override, ts-functions, ts-unknown, ts-instanceof, ts-map-set]
---*/
// HookBase instances return from a generic constructor helper; node reads the initialized base slot during the hook, then finds the derived brand only after super returns. The control uses guarded Maps with the same observations.
const baseValues = new Map<object, number>(), readyValues = new Map<object, boolean>();
class HookBase {
  constructor(value: number, log: unknown[]) { baseValues.set(this, value); this.observe(log); }
  observe(log: unknown[]): void { if (!baseValues.has(this)) throw new TypeError(); log.push(baseValues.get(this)); }
  read(): unknown { if (!baseValues.has(this)) throw new TypeError(); return baseValues.get(this); }
  static owns(value: object): boolean { return baseValues.has(value); }
}
class HookChild extends HookBase {
  constructor(value: number, log: unknown[]) { super(value, log); readyValues.set(this, true); }
  override observe(log: unknown[]): void { super.observe(log); log.push(readyValues.has(this)); }
  ready(): unknown { if (!readyValues.has(this)) throw new TypeError(); return readyValues.get(this); }
  static readyBrand(value: object): boolean { return readyValues.has(value); }
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
