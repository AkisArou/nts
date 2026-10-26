export class Initializer { value = 3; }
export class Constructor { value: number; constructor(n: number) { this.value = n; } }
export class Parameter { constructor(public value: number) {} }
export class Missing { value!: number; }
export class EarlyCall {
  value: number;
  constructor(n: number) { inspect(this); this.value = n; }
}
export class LateCall {
  value: number;
  constructor(n: number) { this.value = n; inspect(this); }
}
export class Alias {
  value: number;
  constructor(n: number) { const receiver = this; inspect(receiver); this.value = n; }
}
export class Closure {
  callback = (): number => this.value;
  value = 3;
}
export class EarlyClosure {
  value: number;
  constructor(n: number) { invoke(() => inspect(this)); this.value = n; }
}
export class PublishingBase {
  constructor() { inspect(this); }
}
export class Derived extends PublishingBase { value = 3; }
export class QuietBase { tag = 17; }
export class QuietDerived extends QuietBase { value = 3; }
export class TaggedEarly {
  value: number;
  constructor(n: number) { tag`${this}`; this.value = n; }
}
export class ThrowEarly {
  value: number;
  constructor(n: number) { if (n < 0) throw this; this.value = n; }
}
export class NullishEarly {
  value: number;
  constructor(n: number) { holder.last ??= this; this.value = n; }
}
export class Showing { show(): void { inspect(this); } }
export class SuperMethodEarly extends Showing {
  value: number;
  constructor(n: number) { super(); super.show(); this.value = n; }
}
export class ForOfAlias {
  value: number;
  constructor(n: number) { for (const self of [this]) inspect(self); this.value = n; }
}
export interface Valued { value: number }
export class CastEarly {
  value: number;
  constructor(n: number) { inspect((this as Valued).value); this.value = n; }
}
export class CalledFieldEarly {
  report: () => void = () => inspect(this);
  value: number;
  constructor(n: number) { this.report(); this.value = n; }
}
export class OwnReadFirst {
  tag = 1;
  value: number;
  constructor(n: number) { inspect(this.tag); this.value = n; }
}
export class SelfStored { self = this; value = 3; }
export class PrivateReadFirst {
  #secret = 1;
  value: number;
  constructor(n: number) { inspect(this.#secret); this.value = n; }
}
const ownKey: unique symbol = Symbol("ownKey");
export class SymbolWriteFirst {
  [ownKey] = 0;
  value: number;
  constructor(n: number) { this[ownKey] = n; this.value = n; }
}
export class SymbolWriteLast {
  [ownKey] = 0;
  value: number;
  constructor(n: number) { this.value = n; this[ownKey] = n; }
}
const holder: { last?: object } = {};
function tag(_strings: TemplateStringsArray, ..._values: unknown[]): void {}
function inspect(_value: unknown): void {}
function invoke(callback: () => void): void { callback(); }
