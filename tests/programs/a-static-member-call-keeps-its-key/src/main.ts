// Private and public static members differ only in their key. Generator calls
// must name the same definition and keep the concrete generator declaration;
// reading a method as a value must forward to that same definition too.
class Members {
  static *#privateSequence(n: number): Generator<number> {
    yield n;
    yield n + 1;
  }
  static *publicSequence(n: number): Generator<number> {
    yield n;
    yield n + 1;
  }
  static #privateValue(n: number): number {
    return n + 2;
  }
  static publicValue(n: number): number {
    return n + 2;
  }
  static privateGenerator(n: number): number {
    let result = 0;
    for (const value of this.#privateSequence(n)) result += value;
    return result;
  }
  static publicGenerator(n: number): number {
    let result = 0;
    for (const value of this.publicSequence(n)) result += value;
    return result;
  }
  static privateMethod(n: number): number {
    return this.#privateValue(n);
  }
  static publicMethod(n: number): number {
    return this.publicValue(n);
  }
  static privateWrapper(n: number): number {
    const call = this.#privateValue;
    return call(n);
  }
  static publicWrapper(n: number): number {
    const call = this.publicValue;
    return call(n);
  }
}

export function privateGenerator(n: number): number {
  return Members.privateGenerator(n);
}
export function publicGenerator(n: number): number {
  return Members.publicGenerator(n);
}
export function privateMethod(n: number): number {
  return Members.privateMethod(n);
}
export function publicMethod(n: number): number {
  return Members.publicMethod(n);
}
export function privateWrapper(n: number): number {
  return Members.privateWrapper(n);
}
export function publicWrapper(n: number): number {
  return Members.publicWrapper(n);
}
