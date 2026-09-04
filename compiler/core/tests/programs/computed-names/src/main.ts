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

  // A `unique symbol` key, which is *not* a name only the running program
  // knows: the checker resolves it to one property and spells it
  // `__@kTag@N` -- the identifier between the brackets and its own id. The
  // field spelling has always relied on that; the method spelling was refused
  // until the declaration, the hierarchy and the call site were taught the
  // same name.
  [kTag](): number {
    return this.n + 3;
  }

  // The string of the same text, which is a *different member*. This is the
  // collision the mangled name exists to prevent: resolving `[kTag]` by the
  // identifier's text would put these two in one slot, and one of them would
  // silently win.
  ["kTag"](): number {
    return this.n + 4;
  }

  get "getter"(): number {
    return this.n;
  }

  set ["size"](v: number) {
    this.n = v;
  }

  // A private name is a name, and its node kind is not the identifier kind.
  // Leaving it out left this method nameless — and every member declared after
  // it was then neither lowered nor refused, which is the failure the
  // conservation law exists to catch.
  static #check(value: number): number {
    return value + 1;
  }

  #twice(): number {
    return this.n * 2;
  }

  after(): number {
    return Holder.#check(this.#twice());
  }
}
