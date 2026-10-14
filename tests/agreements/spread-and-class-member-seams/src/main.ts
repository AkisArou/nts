// Spread, rest, and the class member forms node's modules use. Each answers a
// number.

class WithStatic {
  static readonly limit = 5;
  static double(n: number): number { return n * 2; }
  value = 1;
  #hidden = 2;
  readHidden(): number { return this.#hidden; }
  get doubled(): number { return this.value * 2; }
  set doubled(v: number) { this.value = v / 2; }
}

/** A static field read through the class. */
export function staticField(): number {
  return WithStatic.limit;
}

/** A static method called through the class. */
export function staticMethod(): number {
  return WithStatic.double(3);
}

/** A private field read by a method of the same class. */
export function privateField(): number {
  return new WithStatic().readHidden();
}

/** A getter on a class instance. */
export function instanceGetter(): number {
  const w = new WithStatic();
  w.value = 4;
  return w.doubled;
}

/** A setter on a class instance. */
export function instanceSetter(): number {
  const w = new WithStatic();
  w.doubled = 10;
  return w.value;
}

/** A rest parameter collecting the extra arguments. */
export function restCollects(): number {
  const sum = (first: number, ...rest: number[]): number => {
    let total = first;
    for (const r of rest) total += r;
    return total;
  };
  return sum(1, 2, 3);
}

/** Spreading an array into a call. */
export function spreadIntoACall(): number {
  const add = (a: number, b: number): number => a + b;
  const args: [number, number] = [4, 5];
  return add(...args);
}

/** Array spread into another array. */
export function spreadIntoAnArray(): number {
  const a = [1, 2];
  const b = [0, ...a, 3];
  return b.length;
}

/** Array destructuring with a rest. */
export function destructuringRest(): number {
  const [first, ...rest] = [7, 8, 9];
  return first * 10 + rest.length;
}

/** Object destructuring renaming a field. */
export function destructuringRename(): number {
  const o = { a: 6 };
  const { a: renamed } = o;
  return renamed;
}
