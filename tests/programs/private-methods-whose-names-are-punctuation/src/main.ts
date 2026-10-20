// Private generator methods named `#$`, `#_` and `#℘`, as test262's
// `elements/*-rs-static-*-privatename-identifier` cases name them. Each gets a
// frame, and the C backend spelled a layout's struct by replacing every
// character that is not alphanumeric with `_`: all three frames were
// `NtsObj_Punctuated____frame`, and clang refused the redefinition. The C name
// escapes `$` and `℘` now, as a function's does.
//
// `Lettered` is the control: the same class with private names of letters,
// which compiled.

class Punctuated {
  static *#$(n: number): Generator<number> {
    yield n;
  }
  static *#_(n: number): Generator<number> {
    yield n + 1;
  }
  static *#℘(n: number): Generator<number> {
    yield n + 2;
  }
  static run(n: number): string {
    let out = "";
    for (const v of this.#$(n)) out += `${v},`;
    for (const v of this.#_(n)) out += `${v},`;
    for (const v of this.#℘(n)) out += `${v}`;
    return out;
  }
}

class Lettered {
  static *#a(n: number): Generator<number> {
    yield n;
  }
  static *#b(n: number): Generator<number> {
    yield n + 1;
  }
  static *#c(n: number): Generator<number> {
    yield n + 2;
  }
  static run(n: number): string {
    let out = "";
    for (const v of this.#a(n)) out += `${v},`;
    for (const v of this.#b(n)) out += `${v},`;
    for (const v of this.#c(n)) out += `${v}`;
    return out;
  }
}

export function punctuated(n: number): string {
  return Punctuated.run(n & 7);
}

export function lettered(n: number): string {
  return Lettered.run(n & 7);
}
