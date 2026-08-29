// A module-scope variable that holds a reference.
//
// A global is a slot that outlives every function, which is the same sentence
// `hir::rc` already uses about a field — so a read out of one is owned by the
// global rather than by the reader, and a store takes its own reference and
// gives up the one the slot was holding. The order is load-old, retain-new,
// store, release-old, and it is that order so that `held = held` is a no-op
// rather than a use-after-free.
//
// Two things had to be true before this could be allowed at all:
//
//   - A store to a global is an *escape*. It reached the escape analysis's
//     catch-all, so `{ tag: n }` assigned to a module-scope variable was placed
//     in the caller's stack frame and the global pointed at dead stack the
//     moment that function returned.
//   - Escaping has to follow through an erasure. An erased value is its payload
//     as far as reachability goes, and marking only the erasure left the object
//     it carries looking frame-local.

type Box = { tag: number };

let held: Box | undefined = undefined;
let label = "start";
let history: number[] = [];

function stash(n: number): void {
  held = { tag: n * 3 };
  label = "stashed";
}

export function roundTrip(n: number): number {
  stash(n);
  if (held === undefined) {
    return -1;
  }
  return held.tag + label.length;
}

// Overwriting is where the release matters: the second object replaces the
// first, and the first has to be given up exactly once.
export function overwritten(n: number): number {
  stash(n);
  stash(n + 1);
  return held === undefined ? -1 : held.tag;
}

// Reading a global and using it straight away takes no reference at all --
// nothing between the read and the use can overwrite the slot, which is what
// `borrows_safely` decides. The tag is that this costs no retain.
export function borrowed(n: number): number {
  return label.length + n;
}

// Assigning a fresh array over the old one, which is where the release has to
// happen exactly once: the global gives up what it was holding and takes its
// own reference to what replaces it.
export function replaced(n: number): number {
  history = [n, n + 1, n + 2];
  let total = 0;
  for (const value of history) {
    total += value;
  }
  return total;
}
