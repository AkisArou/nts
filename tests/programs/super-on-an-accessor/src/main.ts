// `super.x` where `x` is a getter or a setter.
//
// `super.m()` was already answered by `lower_super` from the call path, and
// `super.field` by the field being storage the receiver already has. An
// accessor is neither: it is a **method on the base**, reached by name, and
// reading or writing it through `super` means the base's implementation rather
// than the override.
//
// Without it the receiver was lowered as an ordinary expression, `super` has no
// value of its own, and the refusal was the generic `a super keyword is not
// supported by this lowering yet` — a sentence about the token.
//
// **`Callee::Direct` and never virtual**, which is what `super` means. A
// virtual dispatch would find the override, and for
// `override get scaled() { return super.scaled + 100 }` the override is the
// function asking — so the arms below would recurse until the stack ran out
// rather than answer. `twoDeep` is the one that could only pass under a direct
// call: it chains two overrides, so a virtual `super` never reaches `A` at all.
//
// One walk answers both directions. A predicate beside an emitter is two
// chances to disagree about which class a `super` resolves to, so
// `super_accessor` returns the receiver and the callee together and both sites
// take the pair or neither.

class A {
  v = 1;
  get scaled(): number {
    return this.v * 2;
  }
  set scaled(x: number) {
    this.v = x * 2;
  }
}

class B extends A {
  override get scaled(): number {
    return super.scaled + 100;
  }
  override set scaled(x: number) {
    super.scaled = x + 1;
  }
}

class C extends B {
  override get scaled(): number {
    return super.scaled + 1000;
  }
}

/** One override reaching the base's getter. */
export function overridden(n: number): number {
  const b = new B();
  b.v = n;
  return b.scaled;
}

/** Two overrides chained. A virtual `super` would never reach `A`. */
export function twoDeep(n: number): number {
  const c = new C();
  c.v = n;
  return c.scaled;
}

/** Through the base type, so the *outer* dispatch is virtual and the `super`
 *  inside it is not — the two have to differ. */
export function throughTheBase(n: number): number {
  const b: A = new B();
  b.v = n;
  return b.scaled;
}

/** The setter, which writes through the base's. */
export function written(n: number): number {
  const b = new B();
  b.scaled = n;
  return b.v;
}

/** A getter read inside an ordinary method rather than inside an accessor, so
 *  nothing depends on the enclosing member being an accessor itself.
 *
 *  Declared at the top level because a class *inside a function* is its own gap
 *  — `a class declaration is not supported by this lowering yet` — and a fixture
 *  that fails for something other than its subject attributes the failure to the
 *  wrong change. */
class D extends A {
  compute(): number {
    return super.scaled + 7;
  }
}

export function fromAMethod(n: number): number {
  const d = new D();
  d.v = n;
  return d.compute();
}

/** `super.m()`, which already worked and must keep working.
 *
 *  **`super.field` is not here and cannot be**: TypeScript rejects it outright,
 *  `TS2855 Class field 'k' defined by the parent class is not accessible in the
 *  child class via super`. A probe of mine reported it compiling, which it had
 *  not — the probe counted `NTS` refusals and the program had never typechecked.
 *  So the shapes `super` reaches are a method, a getter and a setter, and a
 *  field is a type error rather than a gap. */
class Base2 {
  k = 5;
  twice(): number {
    return this.k * 2;
  }
}
class Derived2 extends Base2 {
  override twice(): number {
    return super.twice() + this.k;
  }
}

export function methodStillWorks(n: number): number {
  const d = new Derived2();
  d.k = n;
  return d.twice();
}
