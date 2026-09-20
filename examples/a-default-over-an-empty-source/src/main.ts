// `const [[x, y, z] = [4, 5, 6]] = []` — a destructuring default whose source
// has no element at that position, so the default is the only arm that runs.
//
// **Module scope, and that is the whole population.** Inside a function the same
// `[]` is typed `any[]` by the checker's evolving-array inference and refuses as
// *an empty array of unrepresentable type (any)*, which is the `any` question
// and a different row. At module scope the checker assigns the literal **no type
// at all**, which is the case below. Both spellings were written and measured;
// only one of them is what these nine files contain.
//
// Two things were wrong and they compounded.
//
// # A literal with no elements holds nothing, whatever it is typed
//
// With no type on the `[]`, the "empty array literal" branch could not fire and
// the refusal was *an array literal of unrepresentable type (an untyped node)* —
// which sends a reader after a representation gap for a literal with nothing in
// it.
//
// Zero elements is syntactic, and stronger than any argument from the type:
// there is no element to read at any width, so any width is right.
//
// # An arm that never runs still has to typecheck
//
// `defaulted_array_element` builds `length <= index` and branches: the default
// on one side, the element read on the other. For `[[x] = [1]] = []` the test is
// a constant `true` and the element arm is unreachable — but both arms still
// have to agree on a type while the branch is being *built*, and they cannot.
// The element is whatever width the empty literal was given and the default is
// `number[]`. The refusal that came out, *a number where an array is wanted*,
// was about an arm that never runs.
//
// So a source whose length is a constant no greater than the position folds to
// its default and emits no branch at all.
//
// 9 files of the slice-1 `test/language` population, all `statements/const/dstr`
// and their `let`/`var` siblings. Seven neighbours are **not** fixed by this and
// are the reason the test is syntactic: `for (const [[x] = [1]] of [[]])` reads
// from an iteration value rather than from a literal, and a claim about every
// path that could reach an empty array is a much larger claim than this one.

const [[x, y, z] = [4, 5, 6]] = [];
const [only = 5] = [];
const [first = 5, second = 6] = [9];
const [both = 5, present = 6] = [7, 8];

/** The element is absent by construction, so the default is the whole answer. */
export function aNestedArrayDefault(n: number): number {
  return x * 100 + y * 10 + z + n * 0;
}

/** The same with a plain name, which needed the literal to have a width first. */
export function anIdentifierDefault(n: number): number {
  return only + n * 0;
}

/**
 * The control that pins the boundary: one element present, one absent.
 *
 * Position 0 has a value and must read it; position 1 is past the end and must
 * take its default. A fold that fired on the pattern rather than per position
 * would answer 56 here.
 */
export function oneEachWay(n: number): number {
  return first * 10 + second + n * 0;
}

/** The control for the other direction: nothing absent, nothing folded. */
export function nothingIsAbsent(n: number): number {
  return both * 10 + present + n * 0;
}
