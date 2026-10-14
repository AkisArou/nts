// An accessor looks like a property and *is* a call. That is the whole of the
// feature and the whole of the hazard: laying `doubled` out as a field and
// emitting a load for `b.doubled` would read whatever happens to sit at that
// offset.
//
// So an accessor has no storage -- it is a member like a method -- and it is
// emitted under a name that says which it is, because a class may declare
// `get x`, `set x` and a method `x` and all three are different functions.

class Box {
  private value: number;

  constructor(v: number) {
    this.value = v;
  }

  get doubled(): number {
    return this.value * 2;
  }

  set replaced(v: number) {
    this.value = v;
  }

  // A getter and a setter over the same name.
  get held(): number {
    return this.value;
  }

  set held(v: number) {
    this.value = v * 10;
  }

  // A plain method, to show it is a third thing rather than a clash.
  held2(): number {
    return this.value + 1;
  }
}

// An accessor a derived class inherits, resolved to the base that declares it.
class Wider extends Box {
  get tripled(): number {
    return this.doubled + this.held;
  }
}

export function reads(n: number): number {
  return new Box(n).doubled;
}

export function writes(n: number): number {
  const b = new Box(0);
  b.replaced = n;
  return b.doubled;
}

// The setter multiplies by ten and the getter does not, so a value that made a
// round trip is distinguishable from one that did not.
export function roundTrip(n: number): number {
  const b = new Box(0);
  b.held = n;
  return b.held;
}

export function alongsideAMethod(n: number): number {
  const b = new Box(n);
  return b.held * 100 + b.held2();
}

export function inherited(n: number): number {
  return new Wider(n).tripled;
}

// The one shape that refuses. `o.x += 1` reads through the *getter* and writes
// through the setter, and the place this compiler builds for an assignment
// carries one callee. Refused rather than guessed at -- and narrower than it
// looks, since `o.x` and `o.x = v` both work.
class Counter {
  private n = 0;
  get value(): number {
    return this.n;
  }
  set value(v: number) {
    this.n = v;
  }
  bump(): void {
    this.value += 1;
  }
}

// An accessor something **overrides**, which is a call decided by what the
// receiver *is* rather than by what its type says — exactly as for a method,
// and it was not.
//
// `accessor_callee` returned a name and both its call sites wrapped it in
// `Callee::Direct`, so `b.plain` on a `Narrow` typed `Base` ran `Base`'s getter
// and answered 1 where node answers 2. A silent wrong answer, on getters and
// setters alike and on both spellings of the name. The hierarchy had the slot
// the whole time: it records an accessor under `get x` precisely so it can be
// overridden, and nothing ever read it back — because nothing in the corpus
// overrode one.

class Reading {
  held = 1;
  get plain(): number {
    return 1;
  }
  // The symbol-ish spelling, which is what `runtime/node` writes as
  // `override get ["constructor"]()`. Two spellings of one member, and a fix
  // that reached only one of them would pass on the other.
  get ["computed"](): number {
    return 1;
  }
}

class Overriding extends Reading {
  override get plain(): number {
    return 2;
  }
  override get ["computed"](): number {
    return 2;
  }
}

// Three deep, so the answer is not "whichever class was laid out last".
class Middling extends Reading {
  override get plain(): number {
    return 3;
  }
}

class Deepest extends Middling {}

export function anOverriddenGetter(n: number): number {
  const r: Reading = n > 0 ? new Overriding() : new Reading();
  return r.plain * 10 + r.computed;
}

export function anOverrideTwoClassesUp(n: number): number {
  const r: Reading = n > 0 ? new Deepest() : new Overriding();
  return r.plain;
}

class Storing {
  held = 0;
  set value(v: number) {
    this.held = v;
  }
}

class Doubling extends Storing {
  override set value(v: number) {
    this.held = (v * 2) | 0;
  }
}

export function anOverriddenSetter(n: number): number {
  const s: Storing = n > 0 ? new Doubling() : new Storing();
  s.value = n;
  return s.held;
}

// And an accessor nothing overrides, which must stay a *static* call: the cost
// of this fix is bounded to the members that need it, and an assertion about
// the overridden ones alone would pass on a lowering that dispatched every
// accessor in the program.
class Alone {
  held = 0;
  get only(): number {
    return this.held + 1;
  }
}

export function anAccessorNobodyOverrides(n: number): number {
  const a = new Alone();
  a.held = n;
  return a.only;
}
