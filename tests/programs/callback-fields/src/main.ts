// A callback held in a field, called through it.
//
// The call is a dispatch: two dependent loads to reach
// `descriptor->methods[slot]`, then an indirect call no C compiler can see
// through -- so the callee is not inlined, whatever it is, and closure bodies
// are usually small enough that not inlining them is most of what they cost.
//
// Where the field can hold only **one** closure, the call is a direct call to a
// named function and all of that goes away. The three exports below are the
// three answers to "which closure is in there": one, several, and unknowable.
// Only the first may be rewritten, and the other two are here so that a rule
// which rewrote them would be caught by something rather than by nobody.

// Each holder carries a **distinct** extra field, and that is not decoration.
// Layouts are structural, so two holders spelled the same way are one layout --
// and the analysis is keyed by layout, so they would share one answer. Five
// holders of one shape in one program means the field holds five things and the
// call stays a dispatch everywhere. Distinguishing them is what lets each case
// below be about itself.
type One = { tag1: number; fn?: (x: number) => number };
type Two = { tag2: number; fn?: (x: number) => number };
type Three = { tag3: number; fn?: (x: number) => number };
type Four = { tag4: number; fn?: (x: number) => number };
type Five = { tag5: number; fn?: (x: number) => number };
type Six = { tag6: number; fn?: (x: number) => number };

function plusOne(x: number): number {
  return x + 1;
}

function timesTwo(x: number): number {
  return x * 2;
}

// One closure, stored on one path. The call is direct.
export function single(n: number): number {
  const h: One = { tag1: 1 };
  if (n > 0) {
    h.fn = plusOne;
  }
  return (h.fn?.(n) ?? -1) | 0;
}

// Two different closures reach the same field, so the field is not one closure
// and the call stays a dispatch. Both arms are taken across the pool, so a
// rewrite that picked either would disagree with node on half the cases.
export function eitherOf(n: number): number {
  const h: Two = { tag2: 2 };
  if (n % 2 === 0) {
    h.fn = plusOne;
  } else {
    h.fn = timesTwo;
  }
  return (h.fn?.(n) ?? -1) | 0;
}

// The closure arrives as a parameter, so what is stored is not decidable from
// the store. Called with both, for the same reason as above.
function install(h: Three, f: (x: number) => number): void {
  h.fn = f;
}

export function throughAParameter(n: number): number {
  const h: Three = { tag3: 3 };
  // Two call sites rather than `install(h, cond ? plusOne : timesTwo)`: a
  // conditional whose arms are two *function* types is a union with no layout,
  // which this compiler refuses for its own reasons. Two calls say the same
  // thing about the field and say it in a shape that compiles.
  if (n % 2 === 0) {
    install(h, plusOne);
  } else {
    install(h, timesTwo);
  }
  return (h.fn?.(n) ?? -1) | 0;
}

// The absent case still has to work: a field nothing ever stores into is
// `undefined`, and calling it is the `??` fallback rather than a call.
export function neverInstalled(n: number): number {
  const h: Four = { tag4: 4 };
  return (h.fn?.(n) ?? n - 1) | 0;
}

// **One known store and one unknown one**, into the same field.
//
// This is the case that separates "unknown" from "nothing stored", and it is
// the one where getting it wrong is silent: an unknown store treated as absent
// leaves `plusOne` looking like the only closure the field can hold, and then
// half these calls go to the wrong function and return the wrong number. Both
// paths are taken across the pool, so node disagrees on half of them.
function installSix(h: Six, f: (x: number) => number): void {
  h.fn = f;
}

export function mixedSources(n: number): number {
  const h: Six = { tag6: 6 };
  if (n % 2 === 0) {
    h.fn = plusOne;
  } else {
    installSix(h, timesTwo);
  }
  return (h.fn?.(n) ?? -1) | 0;
}

// A capturing closure in the same field, so the one that is rewritten is not
// the only kind that can be there. `plusOne` is a named function and this is
// not: it carries `n`.
export function capturing(n: number): number {
  const h: Five = { tag5: 5 };
  const base = n | 0;
  h.fn = (x: number) => (x + base) | 0;
  return (h.fn?.(n) ?? -1) | 0;
}
