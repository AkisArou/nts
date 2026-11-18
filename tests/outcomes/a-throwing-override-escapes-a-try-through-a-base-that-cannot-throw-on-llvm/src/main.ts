// run: check
// backend: llvm

// L15 (#862): reading an overridden method as a value through its base loses the
// override's throw, whether or not the base method can throw itself. Calling
// the same method directly is the agreeing one-difference control, through
// either base: a direct call through a base that cannot throw asks every
// override since #843, and is guarded by
// `tests/programs/a-throwing-override-under-a-computed-key-through-a-base`.
// Child-typed direct dispatch is an additional agreeing control. n=27 gives
// each entry one case.

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

function viaThrowingBaseAsAValue(source: ThrowingBase, n: number): number {
  const callback = source.step;
  try {
    return callback(n);
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

/** Control: called directly through the base-typed receiver. */
export function throughBase(): number {
  return viaBase(new Child(), 27);
}

/** Subject: read as a value through the base-typed receiver (Worker B's case). */
export function throughBaseAsAValue(): number {
  return viaBaseAsAValue(new Child(), 27);
}

/** Control: the receiver typed as the class whose method throws. */
export function throughChild(): number {
  return viaChild(new Child(), 27);
}

/** Control: the base method can throw too. */
export function throughABaseThatCanThrow(): number {
  return viaThrowingBase(new ThrowingChild(), 27);
}

/** Subject: a method value still loses the throw when the base can throw. */
export function throughABaseThatCanThrowAsAValue(): number {
  return viaThrowingBaseAsAValue(new ThrowingChild(), 27);
}
