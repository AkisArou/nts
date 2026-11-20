// A copy of a generic body runs the members its type argument declares, and a
// `throw` from one reaches the `try` around it (#888). The guard's companions
// to `outcomes/a-structural-type-argument-throws-past-its-bound`, one shape
// each:
//
//   accessor    a `get [kV]` read through `T extends Box`, with `Other`
//               matching `Box` only structurally;
//   inClass     the same method call in a generic class's copy, `Reader<Other>`;
//   mixed       one generic copied three ways: at the bound itself (quiet), at a
//               structural `Other` (throws) and at a subclass whose override
//               throws -- each copy names its own member;
//   literal/field  an object-literal method and a callable field, paired with
//               controls that invoke the same members without a generic call;
//   quietCopy   the converse: a bound whose method throws and a structural
//               argument whose method cannot, so the quiet copy must compile
//               and answer.
//
// The throw analysis read a generic body once, at its bound, while lowering
// calls what each copy's argument declares. The failing arms lose the throw or
// name a raising copy that was never made; their controls agree with node.
// The one-difference control is
// programs/a-structural-type-argument-throws-past-its-bound-control, where the
// argument extends the bound.

const kV = Symbol("v");

class Box {
  get [kV](): number {
    return 1;
  }
  m(): number {
    return 1;
  }
}

class Other {
  readonly n: number;
  constructor(n: number) {
    this.n = n;
  }
  get [kV](): number {
    if (this.n > 2) {
      throw new RangeError("big");
    }
    return this.n * 10;
  }
  m(): number {
    if (this.n > 2) {
      throw new RangeError("big");
    }
    return this.n * 10;
  }
}

class Sub extends Box {
  readonly n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
  override m(): number {
    if (this.n > 4) {
      throw new RangeError("bigger");
    }
    return this.n * 100;
  }
}

class Loud {
  readonly n: number;
  constructor(n: number) {
    this.n = n;
  }
  m(): number {
    if (this.n > 2) {
      throw new RangeError("loud");
    }
    return this.n;
  }
}

class Quiet {
  readonly n: number;
  constructor(n: number) {
    this.n = n;
  }
  m(): number {
    return this.n * 3;
  }
}

function attempt(run: () => number): number {
  try {
    return run();
  } catch {
    return -1;
  }
}

function get<T extends Box>(r: T): number {
  return r[kV];
}

function call<T extends Box>(r: T): number {
  return r.m();
}

function callLoud<T extends Loud>(r: T): number {
  return r.m();
}

class Reader<T extends Box> {
  read(r: T): number {
    return r.m();
  }
}

export function accessor(n: number): number {
  return attempt(() => get(new Other(n & 7)));
}

export function inClass(n: number): number {
  const reader = new Reader<Other>();
  return attempt(() => reader.read(new Other(n & 7)));
}

export function mixed(n: number): number {
  const quiet = attempt(() => call(new Box()));
  const structural = attempt(() => call(new Other(n & 7)));
  const derived = attempt(() => call(new Sub(n & 7)));
  return quiet * 10000 + structural * 100 + derived;
}

export function quietCopy(n: number): number {
  const loud = attempt(() => callLoud(new Loud(n & 7)));
  const quiet = attempt(() => callLoud(new Quiet(n & 7)));
  return loud * 100 + quiet;
}

// Keep value-member calls on a quiet bound with no subclass overrides. Otherwise
// Sub#m can seed a raising copy through Box and accidentally mask the literal bug.
class ValueBox {
  m(): number { return 1; }
}
function callValue<T extends ValueBox>(r: T): number { return r.m(); }

class Field {
  readonly [kV] = 1;
  readonly n: number;
  constructor(n: number) {
    this.n = n;
  }
  m = (): number => {
    if (this.n > 2) {
      throw new RangeError("field");
    }
    return this.n * 10;
  };
}

export function literal(n: number): number {
  const k = n & 7;
  return attempt(() => callValue({
    [kV]: 1,
    m(): number {
      if (k > 2) {
        throw new RangeError("literal");
      }
      return k * 10;
    },
  }));
}

export function literalControl(n: number): number {
  const k = n & 7;
  return attempt(() => ({
    [kV]: 1,
    m(): number {
      if (k > 2) {
        throw new RangeError("literal");
      }
      return k * 10;
    },
  }).m());
}

export function field(n: number): number {
  return attempt(() => callValue(new Field(n & 7)));
}

export function fieldControl(n: number): number {
  return attempt(() => new Field(n & 7).m());
}

function char<T extends string>(value: T): number { return value.charCodeAt(0); }
export function primitiveControl(n: number): number { return char(n & 1 ? "a" : "b"); }

interface HasM { m(): number; }
function callI<T extends HasM>(r: T): number { return r.m(); }
export function interfaceBound(n: number): number {
  return attempt(() => callI(new Other(n & 7)));
}

class GetterMethod {
  readonly [kV] = 1;
  readonly n: number;
  constructor(n: number) { this.n = n; }
  get m(): () => number {
    const n = this.n;
    return () => {
      if (n > 2) { throw new RangeError("getter's callable"); }
      return n * 10;
    };
  }
}
export function getterMethod(n: number): number {
  return attempt(() => callValue(new GetterMethod(n & 7)));
}
export function getterMethodControl(n: number): number {
  const method = new GetterMethod(n & 7).m;
  return attempt(() => method());
}
