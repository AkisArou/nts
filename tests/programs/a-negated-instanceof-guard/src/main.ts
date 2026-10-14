// A negated `instanceof` guard, which is how a guard clause is written.
//
// `e2dfdc68e` re-types a binding an `instanceof` proved, for the arm the test
// guards. That covers `if (s instanceof Square) { … }` and nothing else, and the
// shape real code writes at least as often is the **negation**:
//
//     if (!(s instanceof Square)) { return -1; }
//     return s.side;
//
// where the narrowing belongs to everything *after* the `if`, because the `then`
// arm left. `runtime/node/timers`' `listOnTimeout` is written that way, and the
// node-port lane reduced it.
//
// The rule is one line and it covers both directions. Where one arm leaves and the
// other does not, the merge has a single predecessor, and the surviving arm carries
// what the test proved on that edge: `proved == then_open`. That is the guard clause
// *and* its mirror, `if (s instanceof Square) { … } else { return -1; }`. It needs
// no unwinding either, because with **both** arms open the merge joins a narrowed
// path and an unnarrowed one and `merged_type` already reimposes the declaration's
// type on the parameter -- which `bothArmsOpen` is here to hold.
//
// # Why the subject is a methods-only interface, and it is not presentation
//
// The change is observable only where the declared type **does not declare the
// member**, and three shapes that look like they would show it do not:
//
//   - a **class** base: `h.extra` after the negated guard already compiled, because
//     the member-read path does its own erase-and-unerase and `put_bases_first`
//     makes the pointer right;
//   - **`unknown`**, and a **union of classes**: both already compiled, for the
//     same reason.
//
// So the subject has to be a type that declares `area` and not `side`. And it has
// to be a **methods-only** interface rather than one carrying a field, because
// `hierarchy::is_interface` emits an interface that declares a property as a JVM
// *class* -- so no class can implement it there, and the whole program is declined
// on that backend for a standing reason that has nothing to do with narrowing. A
// field-carrying interface is the corpus's shape (`Node0`/`Handle` in `timers`) and
// is covered by the change; it simply cannot be an example until the JVM can hold
// it, which is the interface-representation work.
//
// **Two classes and a condition, so nothing can specialise the interface away.**
// That is the trap the reducing lane hit: a helper called with a concrete class gets
// a structural copy, the interface disappears, and the arm compiles for a reason
// that has nothing to do with narrowing. Their own exported arms passed for exactly
// that reason while the helpers inside them refused.

interface Shape {
  area(): number;
}

class Square implements Shape {
  side = 4;
  area(): number {
    return this.side * this.side;
  }
}

class Circle implements Shape {
  area(): number {
    return 3;
  }
}

/// Two implementers and a condition, so no structural copy can remove the interface.
///
/// **Written with an `if` rather than a conditional expression, deliberately.** A
/// conditional whose two arms are two different classes, returned at an interface
/// type, produces a merge parameter that is correctly `erased` and then an
/// **unchecked `unerase` to the interface's own layout** -- whose method table is
/// empty, so a call through it is a null jump. That is a silent segfault on today's
/// compiler, reduced separately and pinned as an outcome; it is the same defect the
/// React lane reports at some forty `pendingProps as SuspenseProps` sites. Using it
/// here would put a landmine beside the subject and make the example's agreement
/// depend on which of the two failures a given program gets.
function shape(n: number): Shape {
  if (n > 0) {
    return new Square();
  }
  return new Circle();
}

/// The subject: a negated guard with an early return, then a read the interface
/// does not declare.
export function guardClause(n: number): number {
  const s = shape(n);
  if (!(s instanceof Square)) {
    return -1;
  }
  return s.side + 1;
}

/// The same region written as the `else` of a negated test.
export function negatedElse(n: number): number {
  const s = shape(n);
  if (!(s instanceof Square)) {
    return -2;
  } else {
    return s.side + 2;
  }
}

/// The mirror: a positive test whose `else` leaves, so what follows is narrowed
/// through the *then* arm. One condition covers both directions.
export function positiveWhoseElseLeaves(n: number): number {
  const s = shape(n);
  if (s instanceof Square) {
    // Deliberately empty: the point is what follows the `if`.
  } else {
    return -3;
  }
  return s.side + 3;
}

/// A doubled negation, which the sense is *counted* through rather than given an
/// arm of its own.
export function doubledNegation(n: number): number {
  const s = shape(n);
  if (!!(s instanceof Square)) {
    return s.side + 4;
  }
  return -4;
}

/// Control: the positive arm, which `e2dfdc68e` covers and which must not move.
export function thePositiveArm(n: number): number {
  const s = shape(n);
  if (s instanceof Square) {
    return s.side + 5;
  }
  return -5;
}

/// Control: both arms open, so the merge widens back to the declared type and only
/// what `Shape` declares is available after the `if`. If a narrowing ever leaked
/// past a merge both of whose arms are live, this is what would stop compiling.
export function bothArmsOpen(n: number): number {
  const s = shape(n);
  let seen = 0;
  if (s instanceof Square) {
    seen = 1;
  } else {
    seen = 2;
  }
  return s.area() + seen;
}
