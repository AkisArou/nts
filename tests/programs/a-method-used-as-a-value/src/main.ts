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

// # A generator method used as a value
//
// Refused by name until 2026-09-20 — 40 files of the slice-1 `test/language`
// population, every one `private-gen-meth-*`, of which **36 now pass**.
//
// Calling a generator produces its *frame*, whose type is synthetic and
// per-declaration (`managed<generator#0>`), while the type the checker gives
// the call is the abstract `Generator<…>` object that a wrapping closure is
// declared with. The two disagreed — `Closure8#call(…) -> managed<obj#31>`
// returning a `managed<generator#0>` — which is invalid HIR and so no output
// at all.
//
// **Nothing was done to fix it.** `suspend::yielded_slot` made the abstract
// `Generator<…>` representable for an uninhabited element, and a frame's
// layout already has that class as its *base* — so the two are one pointer and
// `compatible` has always permitted the upcast, at a return as much as at an
// argument. The refusal was written against a state of the world that a change
// three commits later removed, and nothing would have said so: **a refusal does
// not fail when it stops being necessary.** It was found by re-running the
// census row, not by reading the comment that explained it.

class Rows {
  *#pairs(): Generator<number, void, unknown> {
    yield 1;
    yield 2;
  }

  get pairs(): () => Generator<number, void, unknown> {
    return this.#pairs;
  }

  *plain(): Generator<number, void, unknown> {
    yield 4;
  }
}

/** Through a getter, which is the shape the corpus writes. */
export function throughAGetter(n: number): number {
  let total = 0;
  for (const v of new Rows().pairs()) {
    total = total + v;
  }
  return total + n * 0;
}

/** Directly off the instance, with no getter in the way. */
export function offTheInstance(n: number): number {
  const g = new Rows().plain;
  let total = 0;
  for (const v of g()) {
    total = total + v;
  }
  return total + n * 0;
}

/** And one that yields nothing, which is where the representation came from. */
class Silent {
  *#none(): Generator<never, void, unknown> {}

  get none(): () => Generator<never, void, unknown> {
    return this.#none;
  }
}

export function aSilentGeneratorMethodAsAValue(n: number): number {
  let count = 0;
  for (const v of new Silent().none()) {
    count = count + 1;
  }
  return count + n * 0;
}

// # `f.name`
//
// A function value here is a **closure class**, one per declaration and final,
// so its name is a property of the class rather than of the value — and
// `ClosureInfo::node` is the declaration it was made for. There is nothing to
// read at run time and no field to lay out, so the answer is a constant.
//
// It refused as ``name`, which `an anonymous type` does not declare`` — a true
// sentence about the layout and a misleading one about the program, which
// names the function in its own source.
//
// **Two ways a value is a named function here**, and the second reaches further
// than it first looked.
//
// A **closure class** is one per declaration and final, so `ClosureInfo::node`
// is the declaration it was made for. That covers a function value read
// directly: a plain function, a method, a static method, a generator method.
//
// A value whose static type is a **function type** covers the rest. I recorded
// here that it could not — that the `private-*-method-name` files read `.name`
// through a getter, so "one function type can hold any function with that
// signature" and following the value back would be dataflow. **That was wrong,
// and checking it took one probe.** An *unannotated* getter returning
// `this.#method` has the private method's **own** function type, whose symbol
// is declared by the method — so the name is one lookup away and no dataflow
// is involved. 14 of those 17 files now pass.
//
// What made the claim look true was my own probe: I wrote the getter with an
// explicit `(n: number) => number`, which really is an anonymous type with no
// declaration behind it, and read the refusal as the general case. The corpus
// writes no annotation. **A fixture that differs from the corpus in one
// incidental way can confirm a limitation that is not there.**
//
// An anonymous signature written in an annotation still refuses, and should:
// one such type can hold any function with that signature, so there is no name
// to give. The three files left in that row are a different question again —
// `array.toString !== Array.prototype.toString`, which needs function identity
// for a prototype method.
//
// An **arrow** is not covered either: `const beta = () => 1` has
// `beta.name === "beta"` in JavaScript, by NamedEvaluation off the *binding*
// rather than off the function, and this reads the declaration.

function namedAlpha(n: number): number {
  return n;
}

class Names {
  twice(n: number): number {
    return n * 2;
  }

  *rows(): Generator<number, void, unknown> {
    yield 1;
  }

  static from(n: number): number {
    return n;
  }
}

/** A plain function used as a value. */
export function aFunctionsName(n: number): string {
  const f = namedAlpha;
  return f.name + (n < 1 ? "" : "!");
}

/** A method. */
export function aMethodsName(n: number): string {
  const m = new Names().twice;
  return m.name + (n < 1 ? "" : "!");
}

/** A generator method, whose value is the same kind of closure. */
export function aGeneratorMethodsName(n: number): string {
  const g = new Names().rows;
  return g.name + (n < 1 ? "" : "!");
}

/** A static, which has no receiver to bind. */
export function aStaticMethodsName(n: number): string {
  const s = Names.from;
  return s.name + (n < 1 ? "" : "!");
}

/**
 * The control: the value still calls. A change that answered `.name` by
 * replacing the closure with its name would pass every arm above and lose
 * this one.
 */
export function theValueStillCalls(n: number): number {
  const m = new Names().twice;
  const s = Names.from;
  return m(n) + s(n);
}

class Hidden {
  #method(n: number): number {
    return n;
  }

  getPrivateMethod() {
    return this.#method;
  }
}

/**
 * The corpus's shape: `.name` off a **private** method reached through an
 * unannotated getter. The `#` stays, which is what the test asserts, and it
 * needs `member_name_of` rather than `declared_name` — a private method's name
 * node is a `PRIVATE_IDENTIFIER`, and looking for an `IDENTIFIER` reports that
 * the method has no name.
 */
export function aPrivateMethodsName(n: number): string {
  return new Hidden().getPrivateMethod().name + (n < 1 ? "" : "!");
}

/** And it still calls, which a rule that replaced the value would lose. */
export function thePrivateMethodStillCalls(n: number): number {
  return new Hidden().getPrivateMethod()(n);
}
