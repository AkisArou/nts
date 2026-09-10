// expect: lowers
//
// **`new B() instanceof A` answers `true` where node answers `false`, and
// nothing is refused.**
//
// Two classes whose fields match exactly share one layout, and a layout carries
// a list of the types it covers:
//
//     layouts.iter().find(|layout| layout.types.contains(class))
//
// `instance_of` resolves each class in the test to a layout and compares the
// object's descriptor with that layout's. When `A` and `B` are the same layout
// they are the same descriptor, so the comparison cannot separate them. The
// emitted C for all three functions below is the same line:
//
//     v4 = (nts_is_class(v3, &nts_desc_NtsObj_A));
//
// There is one descriptor in the program. `class B` does not exist at runtime;
// it *is* `A`.
//
// # Why this is a `lowers` guard and not a refusal
//
// Nothing refuses. The program compiles, runs, and answers the wrong thing, so
// there is no diagnostic to assert on and a refusal-shaped fixture would have
// nothing to say. What this file asserts is that the program still lowers; the
// wrong *answer* is asserted by `examples/two-classes-one-descriptor` --
// deliberately absent, because an example must agree with node and this one
// cannot yet.
//
// That absence is the honest form. Writing the example and letting it fail
// would make the gate red for everyone on a defect nobody is fixing today;
// writing it and trimming it until it passes would be the thing this tree calls
// a vacuous control.
//
// # How it was found
//
// Not by looking for it. `examples/a-private-name-is-a-brand` was written to
// check that `#list in value` distinguishes a class from a decoy declaring a
// private name spelled the same way, and it failed with 58 cases disagreeing
// after the restriction to the declaring class was already correct and verified
// by hand. The decoy was an exact structural twin of the class under test, so
// the fixture was measuring this instead. Giving the decoy one extra field
// separated the two questions and the private-name fixture passes.
//
// A fixture that fails for a reason other than the one it was written for is
// the same trap as one that passes for a reason other than the one it was
// written for, and it is harder to notice because failure looks like work to do.
//
// # How far it reaches, measured
//
// **Not to native classes.** The obvious escalation is `util/src/types.ts`,
// whose ~16 typed-array predicates are each `value instanceof Uint8Array`, and
// typed arrays are the purest same-shape case there is -- `Uint8Array` and
// `Int8Array` differ in element interpretation and in nothing a layout would
// see. `util` publishes `types`, so a collapse there would make
// `isUint8Array(new Int8Array(2))` answer `true` on a published surface.
//
// It does not. Typed-array `instanceof` never reaches the layout lookup:
//
//     v46 = nts_is_view_kind(v44, v45);
//
// an element-kind test rather than `nts_is_class`. These are `View`/`AnyView`
// in this representation and never `Object(TypeId)`. Checked in the emitted C
// rather than argued: `i8IsNotU8`, `u16IsNotU8`, `f64IsNotU8` and `u8IsNotF64`
// all agree with node.
//
// So the blast radius is **user-declared classes that share a field shape**,
// and nothing with an element kind, nothing native, no host surface. That is a
// much smaller and more checkable set than "anything using `instanceof`", and
// it is the reason this is filed rather than treated as an emergency.
//
// # Which pairs actually collapse, measured
//
// Not every same-shaped pair, and the exceptions are what make the exposure
// small. Each row below is a control in this file.
//
//     no base, identical fields                COLLAPSES
//     same *user* base, identical extra field  COLLAPSES
//     two field-less siblings of one parent    COLLAPSES
//     identical fields, base `TypeError`       COLLAPSES
//     ancestor vs descendant                   distinct
//     same field name, different type          distinct
//     different field name, same type          distinct
//
// **The base does not separate anything**, and an earlier version of this table
// said it did. That row read `identical fields, base TypeError -- distinct`, on
// a probe whose output I read with `tail -5`: two of the three functions fit in
// those five lines and the error pair was disagreeing three lines above where I
// stopped. Counting per function says `twoIsNotOne` was wrong on eight cases the
// whole time. **A tail is not a summary.**
//
// The emitted C says it without arithmetic, which is where the typed-array
// question got answered correctly and where this one should have been:
//
//     static void ERR_TWO__constructor(NtsObj_ERR_ONE * v0);
//
// One descriptor, and `ERR_TWO` *is* `ERR_ONE`.
//
// **Inheritance depth is safe; siblings are not.** A subclass adding no fields
// keeps its parent's field list exactly, which looks like the worst case and is
// not one: `parent instanceof Child` answers `false` and `child instanceof
// Parent` answers `true`, both correct. What collapses is two *siblings* that
// each add nothing -- they are indistinguishable from each other while both
// remain distinguishable from the parent.
//
// That distinction decides a real list. The Node lane swept the published
// classes for same-shaped pairs and found `Duplex`/`PassThrough`,
// `Duplex`/`Transform` and `PassThrough`/`Transform`. All three are **chain**
// relationships -- `PassThrough extends Transform extends Duplex` -- so all
// three are fine, and node's tests telling them apart with `instanceof Duplex`
// and `instanceof Transform` would keep working.
//
// The Node lane surveyed the shaped surface and found **89 of 93 `ERR_*`
// classes in one shape group, 87 sharing exactly `[code: string]`** -- this
// defect at its maximum anywhere in the tree. That group is real and the base
// does not save it.
//
// `emit-c` on `os` does emit 62 distinct `ERR_` descriptors, and that is a fact
// about *those* classes rather than about the base: several `ERR_*` take extra
// arguments and carry extra fields, so their layouts differ on the fields. I
// counted descriptors and inferred a mechanism that was not there.
//
// What keeps the family unexposed is the Node lane's two latency arguments,
// both checked: there is **no `instanceof ERR_` anywhere in `runtime/node`**,
// and an error crossing the napi boundary arrives as a host `TypeError` with
// `code` set -- a string *value*, and a value survives a collapse that an
// identity would not. So: latent, not absent. That is the weaker claim, it
// needs re-checking whenever someone writes an `instanceof` near an error, and
// it is the true one.
//
// # What is actually merged in `runtime/node`
//
// `tooling/conformance/merged-layouts.mjs` reads the layout out of `nts hir`'s
// own printing -- `func A#constructor(this: managed<obj#1>)` -- so two class
// names against one `obj#N` is a merged layout stated by the compiler rather
// than inferred. Across all 22 modules it finds five groups:
//
//     ErrnoException / UVAddressError                 console, fs, readline, util
//     PrimitiveAsyncSource / PrimitiveSyncSource      7 modules
//     BatchAsyncSource / BatchSyncSource              7 modules
//     BroadcastConsumer / BroadcastConsumerIterator   fs, http, process, stream, zlib
//     ERR_SERVER_NOT_RUNNING / SocketPeerEndedError   dgram, http, net, process
//         (+ HTTPRequestTimeoutError in http, + WriteNoProgressError in process)
//
// **All twelve classes are latent: no `instanceof` in `runtime/` names any of
// them.** So there is no wrong answer being produced today, and every one is a
// wrong answer waiting for the first `instanceof` someone writes.
//
// The sweep **under-reports** and only under-reports. Its signal is the `this`
// parameter of a lowered method, so a class with no constructor and no methods
// emits no line and is invisible -- and two field-less siblings are exactly
// that shape. An empty result is not "no pairs". It does not over-report: every
// group it names, a differential probe confirms.
//
// # What decides the fix
//
// `X.isX(value)` is `value instanceof X` throughout this profile --
// `BlockList.isBlockList`, `SocketAddress.isSocketAddress`, `assert`'s
// `AssertionError`, `util.types`' whole surface. Those are the *documented*
// predicate rather than an incidental use that could be rewritten around, and
// node's answer is identity. **A profile whose `instanceof` cannot separate two
// declared classes cannot implement them.**
//
// # What it would take
//
// A descriptor per class rather than per layout. Sharing the *struct* between
// structurally identical classes is a real economy and is not the problem --
// sharing the identity is. The two backends both compare descriptors, so this
// is one decision affecting both, and it is a representation change rather than
// a lowering fix: it belongs with the Node and JVM lanes rather than in a
// unilateral commit.
//
// Nothing in `runtime/node` is known to depend on it today, which is why it is
// filed rather than rushed. What makes it worth filing loudly is that it is
// silent: every other defect this week announced itself with a diagnostic.

class A {
  x: number;
  constructor(n: number) {
    this.x = n;
  }
}

/** An exact structural twin of `A`. */
class B {
  x: number;
  constructor(n: number) {
    this.x = n;
  }
}

/** Control: the true case, which is right. */
export function aIsA(n: number): boolean {
  return new A(n) instanceof A;
}

/** Answers `true`. Node answers `false`. */
export function bIsNotA(n: number): boolean {
  return (new B(n) as unknown) instanceof A;
}

/** And the other direction, also `true`. */
export function aIsNotB(n: number): boolean {
  return (new A(n) as unknown) instanceof B;
}

class UserBase {
  b: number;
  constructor(n: number) {
    this.b = n;
  }
}
class D1 extends UserBase {
  x: number;
  constructor(n: number) {
    super(n);
    this.x = n;
  }
}
class D2 extends UserBase {
  x: number;
  constructor(n: number) {
    super(n);
    this.x = n;
  }
}

/** Also collapses: a shared *user* base does not separate them. Answers `true`. */
export function d2IsNotD1(n: number): boolean {
  return (new D2(n) as unknown) instanceof D1;
}

class T1 {
  x: number;
  constructor(n: number) {
    this.x = n;
  }
}
class T2 {
  x: string;
  constructor(n: number) {
    this.x = String(n);
  }
}

/** Control: one field type differs. Distinct, and answers `false`. */
export function t2IsNotT1(n: number): boolean {
  return (new T2(n) as unknown) instanceof T1;
}

class Parent {
  hw: number;
  constructor(n: number) {
    this.hw = n;
  }
}
/** Adds no fields, so it carries `Parent`'s field list exactly. */
class ChildA extends Parent {}
/** And a sibling that also adds none. */
class ChildB extends Parent {}

/** Control: the parent is not an instance of the child. Correct, `false`. */
export function parentIsNotChild(n: number): boolean {
  return (new Parent(n) as unknown) instanceof ChildA;
}

/** Control: the child is an instance of the parent. Correct, `true`. */
export function childIsParent(n: number): boolean {
  return (new ChildA(n) as unknown) instanceof Parent;
}

/**
 * Collapses. Two field-less siblings are indistinguishable from each other
 * while both stay distinguishable from `Parent` -- which is why a `PassThrough
 * extends Transform extends Duplex` chain is unaffected and a pair of siblings
 * would not be. Answers `true`; node answers `false`.
 */
export function siblingIsNotSibling(n: number): boolean {
  return (new ChildB(n) as unknown) instanceof ChildA;
}

class ERR_ONE extends TypeError {
  code: string;
  constructor() {
    super("one");
    this.code = "ERR_ONE";
  }
}
class ERR_TWO extends TypeError {
  code: string;
  constructor() {
    super("two");
    this.code = "ERR_TWO";
  }
}

/**
 * The `ERR_*` shape: same field, same provided base. **Collapses** -- answers
 * `true` where node answers `false`, which is what makes the 87-class group a
 * real candidate rather than one the base rules out.
 */
export function errTwoIsNotErrOne(n: number): boolean {
  return ((new ERR_TWO() as unknown) instanceof ERR_ONE) || n < 0;
}
