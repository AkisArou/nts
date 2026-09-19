// `const g = c.twice` — a method read rather than called.
//
//     NTS1001 `twice`, declared by `C` with a type that has no representation
//             (a function type)
//
// A method is not storage: it lives in the dispatch table, so the layout has no
// field for it and the read arrived one line from the refusal that says so. It
// is **175 files** of the slice-1 `test/language` population, spread across two
// ranked rows that look unrelated — *a static field this compiler gave no
// storage* and *declared by `X` with a type that has no representation* — and
// the smallest program that shows it uses neither `private` nor `static`.
//
// An arrow field and a free function used as a value both worked already:
// `arrowField` and `freeFunction` below are those, and they are controls rather
// than features.
//
// # A read does **not** bind the receiver, and that is the whole difficulty
//
// `c.twice` is the function itself, not `c.twice.bind(c)`. Calling it later has
// `this === undefined`, so a body that touches `this` throws. Measured against
// node before anything was built: a method reading `this.k` **throws** where
// the first version of this compiler's answer was `30`.
//
// So a body that reads `this` — or `super`, which is the receiver under another
// name, or an arrow inside the method, which inherits it — is refused by name.
// `readsThis` is deliberately absent below for that reason; an arm that
// disagrees with node is a known failure rather than a fixture.
//
// # But the receiver is still carried, because it *selects* the body
//
// `c.twice` where `c` holds a `D` must reach `D`'s override — that is a virtual
// dispatch and it needs the object. So the closure holds the receiver in field
// 0 and hands it on as `this`, and that is sound exactly while the body cannot
// tell, which is what the refusal above guarantees. `overridden` is the arm
// that would answer `C`'s body if this forwarded directly.
//
// # Three shapes, and only one needs an object
//
// A **static** method has no receiver at all, so it is the free-function case
// under another name: one instance for the whole program. An **instance**
// method needs one object per read — which is also what the language does,
// since `c.twice !== c.twice`.

class C {
  twice(n: number): number {
    return n * 2;
  }

  #thrice(n: number): number {
    return n * 3;
  }

  viaPrivate(n: number): number {
    const g: (v: number) => number = this.#thrice;
    return g(n);
  }

  static half(n: number): number {
    return n / 2;
  }

  static #quarter(n: number): number {
    return n / 4;
  }

  static viaPrivateStatic(n: number): number {
    const g: (v: number) => number = C.#quarter;
    return g(n);
  }
}

class D extends C {
  twice(n: number): number {
    return n * 20;
  }
}

/** The shape the refusal named, and the smallest one that shows it. */
export function anInstanceMethod(n: number): number {
  const g: (v: number) => number = new C().twice;
  return g(n);
}

/** A private one, which is what the corpus writes: `return this.#method`. */
export function aPrivateMethod(n: number): number {
  return new C().viaPrivate(n);
}

/** No receiver at all, so one instance serves the program. */
export function aStaticMethod(n: number): number {
  const g: (v: number) => number = C.half;
  return g(n);
}

export function aPrivateStaticMethod(n: number): number {
  return C.viaPrivateStatic(n);
}

/**
 * **The arm that says the receiver is used for dispatch.** Forwarding directly
 * would run `C`'s body for a `D`, which is a wrong answer rather than a missing
 * one.
 */
export function overridden(n: number, pick: boolean): number {
  const c: C = pick ? new C() : new D();
  const g: (v: number) => number = c.twice;
  return g(n);
}

/** Handed to something else, which is why a function *object* is needed. */
function apply(f: (v: number) => number, n: number): number {
  return f(n);
}

export function passedAlong(n: number): number {
  return apply(new C().twice, n);
}

/** Several parameters, so the forwarding is not a one-argument special case. */
class Pair {
  add(a: number, b: number): number {
    return a + b;
  }
}

export function twoParameters(n: number): number {
  const g: (a: number, b: number) => number = new Pair().add;
  return g(n, n + 1);
}

/** A reference result, so the return is not always a number either. */
class Tagger {
  tag(n: number): string {
    return "x" + n;
  }
}

export function aStringResult(n: number): number {
  const g: (v: number) => string = new Tagger().tag;
  return g(n).length;
}

/** **Control.** An arrow field, which is a real closure and always worked. */
class Arrowed {
  twice = (n: number): number => n * 2;
}

export function arrowField(n: number): number {
  const g: (v: number) => number = new Arrowed().twice;
  return g(n);
}

/** **Control.** A free function used as a value, which always worked. */
function triple(n: number): number {
  return n * 3;
}

export function freeFunction(n: number): number {
  const g: (v: number) => number = triple;
  return g(n);
}

/** **Control.** The ordinary call, which must be unchanged. */
export function calledNormally(n: number): number {
  return new C().twice(n) + C.half(n);
}

// # The link above this one: calling what the getter answered
//
// `new C().f(n)` where `f` is a **getter** returning a function is two
// operations that look like one — read `f`, which *runs the getter*, then call
// what it answered. It was refused as `a method `f` with no declaration in the
// hierarchy`: a true sentence about a question that should not have been asked,
// since the hierarchy has `get f` and no method of that name at all.
//
// A *field* holding an arrow already worked when called that way, which is what
// says the machinery was there and only the getter was not reaching it.
//
// The two together are what the corpus writes — `get method() { return
// this.#method; }` and then `new C().method(…)` — so the read had to produce a
// function object before this could call one. `getterRunsOnce` is the arm that
// pins the operation count: one read, not two.

class Handing {
  #thrice(n: number): number {
    return n * 3;
  }

  get handedOut(): (v: number) => number {
    return this.#thrice;
  }
}

export function callingAGetterResult(n: number): number {
  return new Handing().handedOut(n);
}

let getterCalls = 0;

class Counting {
  get made(): (v: number) => number {
    getterCalls = getterCalls + 1;
    return (n: number): number => n * 2;
  }
}

/** The getter runs once, not once per argument and not twice. */
export function getterRunsOnce(n: number): number {
  getterCalls = 0;
  const answered = new Counting().made(n);
  return answered * 10 + getterCalls;
}

/** **Control.** A field holding an arrow, called the same way — always worked. */
class Held {
  f = (n: number): number => n * 2;
}

export function callingAFieldHeldArrow(n: number): number {
  return new Held().f(n);
}

/** **Control.** A getter returning a number, which must stay a plain read. */
class Plain {
  get v(): number {
    return 7;
  }
}

export function aPlainGetter(n: number): number {
  return new Plain().v + n;
}

// # A destructuring parameter, which is where the layout was missing
//
// `get method() { return this.#m; }` gives the read an **anonymous function
// type** that nothing else in the program names. A type reaching HIR without a
// layout is *invalid HIR* rather than a refusal — `emit-c` prints `refusing to
// emit code from invalid HIR`, writes nothing and exits 0 — and that is what
// `new C().method([]).next()` produced once the read and the call both worked.
//
// It took a destructuring parameter to show it: with a plain parameter the
// function type is one the program already names elsewhere. `[x = 4]` gives it
// a tuple nothing else asks for.
//
// The layout is materialized at the **call**, not at the read, and the
// difference is load-bearing: a read whose closure is refused must not bring
// the class into existence. Doing it in `member_of` built a `call` for a method
// that had already been declined, and the program failed verification instead
// of refusing.
//
// # What is still refused, and why it is refused rather than wrong
//
// A **generator** method used as a value. Calling a generator produces its
// *frame*, whose type is synthetic and per-declaration; the type the checker
// gives the call is the abstract `Generator<…>`, and a wrapping closure is
// declared with that one — so the value that flows and the type that describes
// it disagree. Left as a named refusal because the alternative measured worse:
// without it the emitted C does not compile.

class Destructured {
  #sum([a, b]: [number, number]): number {
    return a + b;
  }

  get handed(): ([a, b]: [number, number]) => number {
    return this.#sum;
  }
}

export function aDestructuredParameter(n: number): number {
  return new Destructured().handed([n, n + 1]);
}

class Defaulted {
  #firstOr([x = 4]: [number?]): number {
    return x;
  }

  get handed(): ([x]: [number?]) => number {
    return this.#firstOr;
  }
}

/** The default is taken when the element is absent. */
export function aDefaultedParameter(n: number): number {
  return new Defaulted().handed([]) * 100 + new Defaulted().handed([n]);
}
