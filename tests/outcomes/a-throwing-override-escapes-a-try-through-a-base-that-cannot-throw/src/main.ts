// run: check
//
// **A throwing override escapes a `try` when it is called through a receiver
// typed by a base whose own method cannot throw.** `source: Base`, the object a
// `Child`, `Child#step` throws for `n > 3`: JavaScript catches it and answers -1;
// nts lets the throw out ("uncaught" with the number). Called directly
// (`source.step(n)`) or read as a value first (`const f = source.step; f(n)`),
// alike.
//
// Found by the compiler lane's Worker B (forwarding audit, 2026-10-04) as the
// method-value case, on main as of 9533b3a5e and its candidate, every backend;
// recorded here at its request. **The direct call fails too**, which is what
// narrowed the cause: whether the call gets a raising entry is decided by the
// *base* declaration the receiver's type names. `Base#step` cannot throw, so no
// raising entry is chosen, and that `Child#step` overrides it with one that can
// is not consulted. The escape family: a `try` that loses its throw.
//
// The receiver is a typed *parameter* in every arm, as in Worker B's reduction:
// a local declared `Base` holding a `new Child()` and read as a method value is a
// separate defect (C that does not compile), recorded in
// `outcomes/a-method-value-read-off-a-base-typed-local-is-uncompilable-c`.
//
// **Controls, one difference each, both agree:**
//   - the same call with the receiver typed `Child`, so the declaration named
//     is the one that throws;
//   - a second pair of classes identical except that the base method can throw
//     too (`n > 100`), so the base declaration has a raising entry and the
//     override's slot is dispatched (bb3534948).

class Base {
  step(n: number): number {
    return n * 2;
  }
}

class Child extends Base {
  override step(n: number): number {
    if (n > 3) throw n;
    return n * 3;
  }
}

class ThrowingBase {
  step(n: number): number {
    if (n > 100) throw n;
    return n * 2;
  }
}

class ThrowingChild extends ThrowingBase {
  override step(n: number): number {
    if (n > 3) throw n;
    return n * 3;
  }
}

function viaBase(source: Base, n: number): number {
  try {
    return source.step(n);
  } catch {
    return -1;
  }
}

function viaBaseAsAValue(source: Base, n: number): number {
  const callback = source.step;
  try {
    return callback(n);
  } catch {
    return -1;
  }
}

function viaChild(source: Child, n: number): number {
  try {
    return source.step(n);
  } catch {
    return -1;
  }
}

function viaThrowingBase(source: ThrowingBase, n: number): number {
  try {
    return source.step(n);
  } catch {
    return -1;
  }
}

/** Subject: called directly through the base-typed receiver. */
export function throughBase(n: number): number {
  return viaBase(new Child(), n);
}

/** Subject: read as a value through the base-typed receiver (Worker B's case). */
export function throughBaseAsAValue(n: number): number {
  return viaBaseAsAValue(new Child(), n);
}

/** Control: the receiver typed as the class whose method throws. */
export function throughChild(n: number): number {
  return viaChild(new Child(), n);
}

/** Control: the base method can throw too. */
export function throughABaseThatCanThrow(n: number): number {
  return viaThrowingBase(new ThrowingChild(), n);
}
