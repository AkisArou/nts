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
function inspect(_value: unknown): void {}
function invoke(callback: () => void): void { callback(); }
