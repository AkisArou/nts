// Two classes with identical fields, told apart.
//
//     class A { x: number }   class B { x: number }
//     new B() instanceof A    was `true`.  node: false.
//
// Nothing refused. It compiled, ran, and answered wrongly -- the only defect of
// its week that emitted no diagnostic. The emitted C had exactly one
// `nts_desc_NtsObj_A` and `static void B__constructor(NtsObj_A *)`: `class B`
// did not exist at run time, it *was* `A`.
//
// # Why the shapes still share and the identities do not
//
// A layout is a shape and a class is an identity, and one field cannot be both.
// The sharing is required -- TypeScript is structurally typed, so
// `readA(new B())` has to pass, `readonly.rs` asserts the sharing on purpose,
// and the JVM lane's shared-base emission needs a base to exist. What was wrong
// was reading identity off it.
//
// So `Program::classes` records the declaring symbol beside the layout, and the
// C backend emits one `NtsDescriptor` per class: same struct, same method
// table, differing in the **address** -- which is what `nts_is_class` compares
// -- and in the name each reports as its own.
//
// The JVM lane's half is the same split in its own spelling: the merged layout
// is the base and each class is an empty subclass of it, so `new` and
// `instanceof` name the subclass while parameters and fields keep the base.
// Zero bytes per object on both lanes.
//
// # The table this holds down
//
//     no base, identical fields                was wrong
//     same user base, identical extra field    was wrong
//     two field-less siblings of one parent    was wrong
//     identical fields, base `TypeError`       was wrong
//     ancestor vs descendant                   was right
//     same field name, different type          was right
//     different field name, same type          was right
//
// Inheritance depth was never the hazard; siblings were. That distinction is
// what cleared the `stream` pairs a shaped-surface sweep had nominated --
// `PassThrough extends Transform extends Duplex` is a chain.

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

function readA(v: A): number {
  return v.x;
}

/** The true case. */
export function aIsA(n: number): boolean {
  return (new A(n) as unknown) instanceof A;
}

/** The defect: answered `true`. */
export function bIsNotA(n: number): boolean {
  return (new B(n) as unknown) instanceof A;
}

/** And the other direction. */
export function aIsNotB(n: number): boolean {
  return (new A(n) as unknown) instanceof B;
}

/**
 * **Structural assignability, which the split must not cost.**
 *
 * The JVM lane measured this before agreeing to anything: two *unrelated*
 * classes would send it into `NTS4001`, trading a wrong answer for a refusal.
 * Keeping one layout is what makes it pass on both lanes.
 */
export function bWhereAIsWanted(n: number): number {
  return readA(new B(n));
}

interface P {
  x: number;
}
interface Q {
  x: number;
}

function readP(v: P): number {
  return v.x;
}

/** Two interfaces of one shape stay interchangeable. Only `CLASS` splits. */
export function qWherePIsWanted(n: number): number {
  const q: Q = { x: n };
  return readP(q) + readP({ x: n });
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

/** A shared *user* base does not separate them either. Answered `true`. */
export function d2IsNotD1(n: number): boolean {
  return (new D2(n) as unknown) instanceof D1;
}

class Parent {
  hw: number;
  constructor(n: number) {
    this.hw = n;
  }
}
class ChildA extends Parent {}
class ChildB extends Parent {}

/** Control: ancestor and descendant were always right, both directions. */
export function parentIsNotChild(n: number): boolean {
  return (new Parent(n) as unknown) instanceof ChildA;
}
export function childIsParent(n: number): boolean {
  return (new ChildA(n) as unknown) instanceof Parent;
}

/** Two field-less siblings: the generator that is *not* inheritance depth. */
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
 * The `ERR_*` shape. A provided base does not separate them -- the row that
 * read `distinct` for an hour on a probe read with `tail -5`, while the pair
 * was disagreeing three lines above where I stopped.
 */
export function errTwoIsNotErrOne(n: number): boolean {
  return ((new ERR_TWO() as unknown) instanceof ERR_ONE) || n < 0;
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

/** Control: one field type differs, so they never shared. */
export function t2IsNotT1(n: number): boolean {
  return (new T2(n) as unknown) instanceof T1;
}
