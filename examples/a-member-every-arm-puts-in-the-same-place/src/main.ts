// Reading a field from a **union of classes** that disagree about their layout.
//
// A discriminated union is written with the discriminant declared first in
// every member -- that is what makes it discriminated -- so `kind` sits at
// offset zero in all of them however much they differ afterwards. The union
// itself has no single representation and erases; the *field* is at one offset
// regardless. Refusing the read was the right answer about the union and the
// wrong one about the field.
//
//     export func unionField(value: erased) -> managed<str> {
//       %1 = unerase %0 : managed<obj#1>
//       %2 = field.get %1.0 : managed<str>
//
// The licence is the one base-first layout already gives a subclass, and the
// one `laid_out_as_a_prefix` already states for a cast: where fields agree in
// name, order and representation, the load is at the same offset whichever
// member is there. `Unerase` is a reinterpretation rather than a checked cast,
// and every object carries the same tag, so no discriminant is tested to do it.
//
// # What each function is for
//
// `bothArms` is the one that matters. It reads the discriminant from a `Left`
// **and** from a `Right` in the same answer, so a read that went through one
// arm's offset for both would come back with the wrong character. Reading only
// one arm would pass while being wrong about the other, which is the failure
// this whole feature is capable of.
//
// `deeperPrefix` agrees on two fields and reads the second, so the rule is
// "within the agreement" and not "the first field only".
//
// `threeArms` is the same question with more than two members, because the
// agreement is computed across all of them and a fold that stopped at the first
// pair would answer wrongly for the third.
//
// `narrowsAfter` is the interaction that could have been broken silently: after
// reading `kind` directly, the checker's narrowing on it still has to produce a
// concrete member for `v.n` and `v.s` to be read at all.
//
// # The controls
//
// `sameNameDifferentType` is the one a weaker rule would get wrong. Both arms
// declare `at` first, so a rule that matched on names alone would read a
// `double` out of a slot holding a pointer. It is a *refusal*, and it is held
// by `blockers/union-members-lay-fields-out-differently` rather than here,
// because a refused function leaves the differential silently and this file
// would go green having stopped testing it.
//
// `singleClass` is the control that stops the diagnostic reading as "`kind` is
// not readable", which was never true.
//
// # The JVM declines this, and that is the design working rather than failing
//
// C and LLVM read the field through a pointer, and a cast between two structs
// with a common initial sequence is what base-first layout already relies on.
// **The JVM has no such cast**, and the first version of this lowering proved
// it the expensive way: an `Unerase` naming one arm became a `CHECKCAST`, and
// this example aborted seventeen times with
//
//     java.lang.ClassCastException: class nts.gen.Right cannot be cast to
//     class nts.gen.Left
//
// It was reverted the same evening. The `Unerase` was not merely wrong there,
// it was **inexpressible**: naming one arm gives a backend no way to learn the
// others, so the failing cast was the only instruction the IR licensed. A
// benchmark could have come out either way and the op would still be needed.
//
// `OpKind::SharedFieldGet` states the fact instead -- these arms agree about
// this field -- and carries the arm types and the field index so each backend
// picks its own instruction. C and LLVM emit the pointer read unchanged. The
// JVM emits one `instanceof`, one `checkcast` and one `getfield` per arm, which
// its lane measured at 1759 ns/pass against 6213 for a synthesised interface:
// an interface makes every read a megamorphic `invokeinterface` whose itable
// lookup defeats inline caching.
//
// **Until that half lands the JVM backend declines the op by name**, and that
// is the whole difference from the first attempt. A decline is a refusal a
// reader can see; a `ClassCastException` inside a floor that absorbs it is not.
// Record 0289.

class Left {
  kind: "l";
  n: number;
  constructor() {
    this.kind = "l";
    this.n = 1;
  }
}

class Right {
  kind: "r";
  s: string;
  constructor() {
    this.kind = "r";
    this.s = "xy";
  }
}

class Third {
  kind: "t";
  flag: boolean;
  constructor() {
    this.kind = "t";
    this.flag = true;
  }
}

function tag(value: Left | Right): string {
  return value.kind;
}

/** Control: the same field from one class. */
export function singleClass(n: number): number {
  const left = new Left();
  return left.kind.charCodeAt(0) + n * 0;
}

/** Under test: both arms, in one answer. `l` is 108 and `r` is 114. */
export function bothArms(n: number): number {
  const a: Left | Right = new Left();
  const b: Left | Right = new Right();
  return tag(a).charCodeAt(0) * 1000 + tag(b).charCodeAt(0) + n * 0;
}

/** Under test: three arms, so the agreement is folded over all of them. */
export function threeArms(n: number): number {
  const values: (Left | Right | Third)[] = [new Left(), new Right(), new Third()];
  let total = 0;
  for (let i = 0; i < values.length; i++) total = total * 1000 + values[i]!.kind.charCodeAt(0);
  return total + n * 0;
}

class HeadA {
  id: number;
  rank: number;
  extra: string;
  constructor(id: number) {
    this.id = id;
    this.rank = 7;
    this.extra = "a";
  }
}

class HeadB {
  id: number;
  rank: number;
  other: boolean;
  constructor(id: number) {
    this.id = id;
    this.rank = 9;
    this.other = false;
  }
}

/** Under test: the agreement is two fields deep and the read is the second. */
export function deeperPrefix(n: number): number {
  const a: HeadA | HeadB = new HeadA(n & 3);
  const b: HeadA | HeadB = new HeadB(n & 1);
  return a.rank * 100 + b.rank * 10 + a.id + b.id;
}

/** Under test: narrowing on a discriminant that was read directly. */
export function narrowsAfter(n: number): number {
  const v: Left | Right = (n & 1) === 1 ? new Left() : new Right();
  if (v.kind === "l") return v.n * 10;
  return v.s.length;
}

class Circle {
  kind: "circle";
  r: number;
  constructor(r: number) {
    this.kind = "circle";
    this.r = r;
  }
}

class Square {
  kind: "square";
  side: number;
  constructor(side: number) {
    this.kind = "square";
    this.side = side;
  }
}

type Shape = Circle | Square;

/**
 * Under test: an **exhaustive** `switch` on the discriminant, with no default
 * arm and every member covered.
 *
 * This is here because `docs/conformance/typescript.md` carried it as struck
 * through and audited-blocked -- "there is no default arm to remove because
 * there is no switch" -- and unstriking a row is a claim that wants a guard
 * under it rather than a sentence. Every arm narrows to a concrete member, so
 * `s.r` and `s.side` are ordinary field reads once `s.kind` is readable.
 */
function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return s.r * s.r * 3;
    case "square":
      return s.side * s.side;
  }
}

export function exhaustiveSwitch(n: number): number {
  return area(new Circle(n & 3)) * 100 + area(new Square(n & 1));
}
