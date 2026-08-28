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
