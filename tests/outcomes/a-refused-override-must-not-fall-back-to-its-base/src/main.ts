// run: check
// backend: jvm
// A missing override must not silently select its inherited base body.
// A manufactured refusal: dynamic eval is outside this compiler's scope.
// Refusing an override must not leave a kept base method dispatching through
// an empty slot, nor let an inherited base body stand in for the override.
// The control changes only the eval expression to the number it evaluates.
class Base {
  invoke(n: number): number { return this.value(n); }
  value(n: number): number { return n + 1; }
}

class Refused extends Base {
  override value(n: number): number { return n + eval("7"); }
}

class Compiled extends Base {
  override value(n: number): number { return n + 7; }
}

export function refused(n: number): number {
  const receiver: Base = new Refused();
  return receiver.invoke(n);
}

export function control(n: number): number {
  const receiver: Base = new Compiled();
  return receiver.invoke(n);
}
