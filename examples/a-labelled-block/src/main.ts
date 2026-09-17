// `outer: { … break outer … }` -- a label on a block rather than on a loop.
//
// Legal JavaScript, where the `break` is a forward jump to the end of the block.
// It was refused, and the refusal said why: it "needs a breakable with an exit
// and no latch, which is a block this does not build".
//
// A `switch` is a breakable with an exit and no latch. The two differ only in
// what sits between the push and the pop, so the block needed no machinery --
// it needed the *shape* that was already there, and to be built where the label
// is read rather than in `lower_statement`, because the breakable has to carry
// the label and a block is not a construct that takes one.
//
// **Falling off the end is the same jump a `break` makes.** That is what
// allocates the exit when no `break` was written, and what leaves it
// unallocated when the block always returns -- `withAReturn` is the arm that
// holds the second case, and an exit no edge reaches is invalid SSA rather than
// merely dead.

/** The plain shape: an early exit from a block. */
export function simple(n: number): number {
  let s = 0;
  block: {
    if (n > 2) {
      break block;
    }
    s = 1;
  }
  return s + n;
}

/** A name assigned on both paths, so the exit has to take it as a parameter and
 *  the two edges have to agree about which value. */
export function assignsOnBothPaths(n: number): number {
  let s = 0;
  block: {
    s = 5;
    if (n > 2) {
      break block;
    }
    s = 9;
  }
  return s + n;
}

/** Nested, and the inner `break` names the *outer* label -- which is the whole
 *  reason to write one. A lowering that took the innermost breakable would
 *  agree with node on `simple` and not on this. */
export function nested(n: number): number {
  let s = 0;
  outer: {
    inner: {
      if (n > 3) {
        break outer;
      }
      s += 1;
    }
    s += 10;
  }
  return s + n;
}

/** Inside a loop, where `break block` must not be mistaken for `break`. */
export function insideALoop(n: number): number {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    block: {
      if (i === 2) {
        break block;
      }
      s += i;
    }
    s += 100;
  }
  return s + n;
}

/** Every path returns, so there is no exit to allocate. */
export function withAReturn(n: number): number {
  block: {
    if (n > 2) {
      return 42;
    }
  }
  return n;
}

/** A name the block declares is the block's own and is not carried out of it. */
export function declaresItsOwn(n: number): number {
  let s = 0;
  block: {
    const inner = n * 2;
    if (inner > 4) {
      break block;
    }
    s = inner;
  }
  return s + n;
}
