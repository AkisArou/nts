// expect: a class field initializer that recursively initializes itself
// TypeScript's privateNameWhenNotUseDefineForClassFieldsInEsNext.ts contains
// `dd = new TestNonStatics().#prop`. Expanding field initializers at each `new`
// revisits that same initializer until the compiler's stack overflows.
// The control changes only the receiver from a new instance to `this`.
// A second arm reaches an initializer again through another class.

class Recursive {
  #prop = 7;
  value: number = new Recursive().#prop;
}

export function recursive(): number {
  return new Recursive().value;
}

class Finite {
  #prop = 7;
  value: number = this.#prop;
}

export function control(): number {
  return new Finite().value;
}

class First {
  value: number = new Second().value;
}

class Second {
  value: number = new First().value;
}

export function indirect(): number {
  return new First().value;
}
