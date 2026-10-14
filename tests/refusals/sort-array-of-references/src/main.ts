// expect: a `sort` with no comparator on an array that does not hold strings
//
// **The string half landed on 2026-09-17 and the numeric half is what is left**,
// which is the opposite of the split this fixture was filed under. It read as a
// *reference* problem — `sort` worked on nothing and refused loudest on
// pointers — and it is not one: the default order converts every element to a
// string and compares the strings by UTF-16 code unit, so an array that already
// holds strings needs no conversion and an array of numbers needs one per
// element. `nts_array_sort_str` is the whole of the first and the second is a
// different helper.
//
// So `sortStrings` below now compiles and agrees with node, and `sortNumbers`
// refuses — with a message that says which question it is, rather than "on an
// array of references". The expectation above moved with it.
//
// `[3, 1, 10].sort()` is **`[1, 10, 3]`**, and refusing is the right direction:
// `[1, 3, 10]` is what a reader expects, is what a silent implementation would
// produce, and is wrong. A missing answer costs a refusal; a wrong one costs a
// program that looks right.
//
// Where it bites: `util/src/inspect.ts:1093` and `:1095` are `keys.sort()` and
// `output.sort()`, which is `util.inspect(value, { sorted: true })` -- a public
// node option, and the only two `.sort()` calls in the whole of `runtime/node`.
// So this is a small blocker with a small blast radius, which is worth saying
// plainly: it is not on `util`'s critical path the way the radix `toString` is
// on everyone's.
//
// The numeric case was put here so that a fix handling only numbers would be
// visible as a partial one. It did the opposite job and did it well: the fix
// handled only *strings*, and this is where that showed up.
//
// Found by a probe that wanted to sort directory entries before comparing them,
// which is instrumentation rather than module source -- that sort moved to the
// comparison side, where it belongs. This fixture is the part that stays.

export function sortStrings(values: string[]): string {
  values.sort();
  return values.join(",");
}

export function sortNumbers(values: number[]): number {
  values.sort();
  return values[0] ?? 0;
}
