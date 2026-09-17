// An object literal holding code, bound at module scope.
//
// `examples/a-method-on-an-object-literal` writes its literals inside a
// function, which is the shape that landed when a literal's members were first
// lowered. At module scope the same literal was refused -- `a method on an
// object literal`, and then the binding as `a module-scope variable whose
// initializer is not constant` -- by a guard whose stated reason was that
// "the methods of an object literal are not walked, so they are not lowered and
// not refused". That was true when it was written and stopped being true when
// they were walked. The refusal outlived its reason and nothing noticed,
// because a guard that refuses is not a guard that fails.
//
// Nothing replaced it. A module-scope binding whose initializer is not constant
// is deferred to `module#init` and built there, which is what a literal with a
// *non-constant field* has always done -- `{ v: seed() }` compiled and ran
// throughout. A literal with a method is the same deferral carrying the same
// kind of value.

const config = {
  scale: 3,
  offset: 10,
  applied(n: number): number {
    return n * this.scale + this.offset;
  },
};

// An arrow rather than a method. It is a closure over nothing, which is the
// case the guard named second and the one that looks least likely to survive
// being stored in a global.
const doubler = {
  twice: (n: number): number => n * 2,
};

// Both kinds in one literal, so a lowering that handled them by different paths
// has to put both in the same object.
const mixed = {
  base: 100,
  add(n: number): number {
    return this.base + n;
  },
  scaled: (n: number): number => n * 4,
};

// A getter beside a method. The accessor lowered at module scope before this
// and the method did not, which is how narrow the gap turned out to be.
const readings = {
  raw: 7,
  get doubled(): number {
    return this.raw * 2;
  },
  plus(n: number): number {
    return this.raw + n;
  },
};

// Two literals each declaring the same member name, which is the case a shared
// layout would answer alike.
const first = {
  which(): number {
    return 1;
  },
};

const second = {
  which(): number {
    return 2;
  },
};

export function methodReadingThis(n: number): number {
  return config.applied(n);
}

export function arrowInAGlobal(n: number): number {
  return doubler.twice(n);
}

export function bothInOneLiteral(n: number): number {
  return mixed.add(n) * 1000 + mixed.scaled(n);
}

export function accessorBesideAMethod(n: number): number {
  return readings.doubled * 100 + readings.plus(n);
}

export function distinctLiterals(n: number): number {
  return first.which() * 10 + second.which() + n;
}
