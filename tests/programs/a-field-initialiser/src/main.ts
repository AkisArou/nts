// Where a class's field initialisers run.
//
// JavaScript runs them inside the class's *own* constructor: at the top when
// there is no base, and immediately after `super()` returns when there is. So
// `class D extends B { y = this.x + 10 }` reads the `x` that `B`'s constructor
// wrote.
//
// They used to be emitted at the **allocation site**, every class's before any
// constructor ran. One placement, wrong three ways:
//
//   - a derived initialiser read a field nobody had written yet -- 28 of 29
//     cases against node, answering `nan`;
//   - a class constructed only through the napi boundary ran none of them,
//     because the wrapper allocates and calls the constructor and there is no
//     allocation site anywhere;
//   - an optional property's presence mask, emitted in the same place, had the
//     same boundary.
//
// What the allocation site keeps is the classes *below* the one whose
// constructor it calls. Those declare no constructor of their own, so nothing
// else would run them, and they go after the call because an implicit
// constructor is `super(...args)` followed by this class's initialisers.
//
// # It hid behind the optimiser, and that is worth knowing
//
// The first probe for this used a constant base value and **agreed with node on
// all 29 cases**. Reading an uninitialised member is undefined behaviour, so
// the same emitted C answered `10` then `7.9e+08` at `-O0` and `11` -- node's
// answer -- at `-O2`. A release build agreed because clang chose to.
//
// Every value below is derived from the argument for that reason: no leftover
// and no folded constant can be the right answer for every input.

class Base {
  x: number;
  fromTheDeclaration: number = 100;

  constructor(n: number) {
    this.x = n * 3;
  }
}

class Derived extends Base {
  seesTheBase: number = this.x + 10;
  ownDeclaration: number = 7;

  constructor(n: number) {
    super(n);
  }
}

class Deeper extends Derived {
  seesBoth: number = this.x + this.seesTheBase;

  constructor(n: number) {
    super(n);
  }
}

// No base: the initialiser runs at the top of the constructor, so the
// constructor's own assignment wins over it.
export function aBaseClass(n: number): number {
  const b = new Base(n);
  return b.x + b.fromTheDeclaration;
}

// One level: the initialiser reads what `super()` stored. This is the case that
// answered `nan`.
export function oneLevel(n: number): number {
  return new Derived(n).seesTheBase;
}

// Two levels, so an initialiser reads a field an initialiser two classes up
// wrote as well as one a constructor wrote.
export function twoLevels(n: number): number {
  return new Deeper(n).seesBoth;
}

// Every field of the deepest class, so a missing initialiser anywhere in the
// chain shows up rather than being averaged away.
export function everyField(n: number): number {
  const d = new Deeper(n);
  return d.x + d.fromTheDeclaration + d.seesTheBase + d.ownDeclaration + d.seesBoth;
}

// A class that declares **no constructor of its own**. Its initialisers are the
// allocation site's, and they still have to run after the base's constructor.
class NoConstructorOfItsOwn extends Base {
  alsoSeesTheBase: number = this.x + 1;
}

export function withNoConstructor(n: number): number {
  const v = new NoConstructorOfItsOwn(n);
  return v.alsoSeesTheBase + v.x;
}

// A class with no base and no constructor either, which is the case where
// nothing runs but the allocation site.
class Plain {
  only: number = 5;
}

export function plain(n: number): number {
  return new Plain().only + n;
}
