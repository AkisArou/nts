// `const [a, b] = pair` and `const { x, y } = point`, at module scope.
//
// Refused until 2026-09-18, and the refusal named the wrong thing:
//
//     NTS1001 `a`, a name from an enclosing scope
//
// which reads as a scoping limitation. What actually happened is that
// `collect_module_scope` declared no storage for a pattern's names — its own
// comment said a destructuring declaration was "left alone rather than
// half-handled", because "inventing one name for several is worse than
// declaring none" — and the read that followed then found no binding either.
// The message is the *second* failure; the first is silent.
//
// The same declaration inside a function has always worked, where `bind_pattern`
// binds the names as ordinary locals. That asymmetry is the whole of the gap: 37
// files of the slice-1 `test/language` population are this, every one a
// `const`/`let`/`var` `dstr` test, and not one of them is under `expressions` —
// which is the directory the conformance lane had measured four times.
//
// # How it is built
//
// The reads are `bind_pattern`'s, unchanged. It is the same function that binds
// the same pattern inside a function body, with its defaults, its nested
// patterns, its renames and its rest elements — so none of those is a case
// here. What differs is only where the values land: a local binds them, and
// module scope copies each into the global the collector gave it, because every
// reader outside `module#init` resolves through `variables` rather than through
// the bindings.
//
// **Both halves walk the pattern with one function.** `pattern_names` answers
// "which names does this declare", the collector uses it to decide which get
// storage and the lowering uses it to decide which get written. Two walks that
// disagreed would leave a name with a global nothing writes — storage reading as
// zero for ever, with no diagnostic anywhere. That is the shape this repository
// keeps finding, so it is one function asked twice rather than two answers.
//
// **Every name or none.** A pattern with a name that cannot be stored refuses
// all of them, because a half-stored pattern is a program where one name holds a
// value and its neighbour silently holds zero.

const [first, second] = [1, 2];
const { x, y } = { x: 10, y: 20 };
const { from: renamed } = { from: 3 };
const { outer: { inner } } = { outer: { inner: 4 } };
const [, skipped] = [8, 9];
const [head, ...tail] = [5, 6, 7];

let [mutableA, mutableB] = [1, 2];
mutableA = 100;

var [hoisted] = [11];

export function readArray(n: number): number {
  return first * 10 + second + n;
}

export function readObject(n: number): number {
  return x + y + n;
}

export function readRenamed(n: number): number {
  return renamed + n;
}

export function readNested(n: number): number {
  return inner + n;
}

/** A hole, which advances the position without declaring a name. */
export function readHole(n: number): number {
  return skipped + n;
}

/** A rest element: a fresh array, so its length is the tail's. */
export function readRest(n: number): number {
  return head * 100 + tail.length * 10 + n;
}

/** `let`, and then written afterwards — the global is storage like any other. */
export function readMutable(n: number): number {
  return mutableA + mutableB + n;
}

/** `var`, which differs from `let` in scope and not in storage. */
export function readHoisted(n: number): number {
  return hoisted + n;
}

// **The control.** A plain identifier declaration, which has always worked and
// goes through the same `declare_a_module_global` as every name above. It
// passes on the compiler that refused all of them.
const plain = 42;

export function readPlain(n: number): number {
  return plain + n;
}
