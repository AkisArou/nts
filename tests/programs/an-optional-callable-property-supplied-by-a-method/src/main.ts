// A structural optional callable property may be supplied by a declared method.
// The control differs only in the interface member declaration.
interface OptionalField {
  run?: ((by: number) => number) | undefined;
}
interface OptionalMethod {
  run?(by: number): number;
}
class Counter {
  value: number = 7;
  run(by: number): number {
    this.value += by;
    return this.value;
  }
}
export function throughField(n: number): number {
  const counter: OptionalField = new Counter();
  return counter.run?.(n) ?? -1;
}
export function throughMethod(n: number): number {
  const counter: OptionalMethod = new Counter();
  return counter.run?.(n) ?? -1;
}
