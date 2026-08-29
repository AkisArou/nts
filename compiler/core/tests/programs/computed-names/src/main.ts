// The line between a name in brackets and a name the program computes.

const kTag: unique symbol = Symbol("tag");

export class Holder {
  private n = 1;

  // Three spellings, three members, all resolved at compile time.
  plain(): number {
    return this.n;
  }
  "quoted"(): number {
    return this.n + 1;
  }
  ["bracketed"](): number {
    return this.n + 2;
  }

  // A name only the running program knows. Refused: it wants a property map
  // rather than a field, and reading it as a name would collide it with
  // whatever `kTag` happens to describe.
  [kTag](): number {
    return this.n + 3;
  }

  get "getter"(): number {
    return this.n;
  }

  set ["size"](v: number) {
    this.n = v;
  }
}
