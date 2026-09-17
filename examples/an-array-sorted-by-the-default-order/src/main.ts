// `xs.sort()` and `xs.toSorted()` with **no comparator**.
//
// The default order is the specification's and it is not a natural one: every
// element is converted to a string and the strings are compared by UTF-16 code
// unit. For an array that already holds strings that conversion is the
// identity, which is why this is the only element type answered — a numeric
// `[3, 1, 10].sort()` is `[1, 10, 3]`, which is right and surprising, and
// building it means a string per element rather than a different comparison.
// Both the numeric case and a comparator are refused **by name**, and each is
// held by a blocker that asserts the message rather than merely that something
// refused: `blockers/sort-array-of-references` (which was filed as a reference
// problem, and turned out to be a string-conversion one — its expectation moved
// with this change) and `blockers/a-sort-with-a-comparator`, which carries the
// three routes to the comparator form and what each costs.
//
// Every string here is written with escapes. The peer lane's probe of the same
// question diverged twice before it was right, and the second time was because
// literal non-ASCII characters did not survive identically into its two arms —
// so the two sides had different inputs and the mismatch read as an ordering
// difference. A fixture compared against node has exactly that hazard.
//
// # What actually discriminates
//
// `\uD800\uDC00` against `\uE000` is the one pair that separates code-*unit*
// order from code-*point* order. U+10000 is code point 65536 and U+E000 is
// 57344, so by code point `\uE000` comes first and by code unit the surrogate
// pair does. Node puts the pair first, the C runtime compares `uint16_t` at a
// time, and Java's `String.compareTo` does the same — so all three agree, and
// this is the arm that would catch any one of them normalising or decoding.
//
// The rest are the cases that usually bite: the empty string sorts first,
// `"10"` before `"9"` because the comparison is lexicographic, and a composed
// `\u00E9` against a decomposed `e\u0301` with no normalisation on either
// side.

function awkward(n: number): string[] {
  return [
    "\uFF3A",
    "\uD800\uDC00",
    "b",
    "\uE000",
    "",
    "9",
    "10",
    "\u00E9",
    "e\u0301",
    "A",
    String(n % 3),
  ];
}

/** In place, and the receiver is the answer — `sort` returns the array it
 *  sorted rather than a copy, which `sortedIsTheSameArray` is here to say. */
export function sortedOrder(n: number): string {
  const xs = awkward(n);
  xs.sort();
  return xs.join(",");
}

/** The surrogate pair against `\uE000`, alone, because inside the list above a
 *  reader cannot see which comparison decided it. */
export function surrogateBeforePrivateUse(n: number): number {
  const xs = ["\uE000", "\uD800\uDC00"];
  xs.sort();
  return (xs[0] === "\uD800\uDC00" ? 1 : 0) + n * 0;
}

/** `sort` hands back the receiver, so mutating through the result is visible
 *  in the source. */
export function sortedIsTheSameArray(n: number): string {
  const xs = ["c", "a", "b"];
  const out = xs.sort();
  out[0] = String(n % 10);
  return xs[0] + xs[1] + xs[2];
}

/** `toSorted` does not touch the source, which is the whole difference between
 *  the two and the only thing that fails if it were wired to the in-place
 *  helper. */
export function toSortedLeavesTheSource(n: number): string {
  const source = awkward(n);
  const copy = source.toSorted();
  return copy[0] + "|" + source[0] + "|" + String(copy.length === source.length);
}

/** Stability, which the specification has required since ES2019. Equal keys
 *  keep their order, and a `qsort` would be free not to — which is why the C
 *  runtime writes a merge sort rather than calling one. */
export function equalKeysKeepTheirOrder(n: number): string {
  const xs = ["b1", "a1", "b2", "a2", "b3"];
  const keys = xs.map((s) => s[0]!);
  keys.sort();
  return keys.join("") + "|" + String(n % 2);
}

/** An empty array and a single element, which the merge sort returns before it
 *  allocates anything. */
export function shortArrays(n: number): string {
  const none: string[] = [];
  const one = ["only"];
  none.sort();
  one.sort();
  return String(none.length) + one[0] + String(n % 2);
}

/** Already sorted and exactly reversed, the two shapes a bottom-up merge walks
 *  differently. */
export function orderedAndReversed(n: number): string {
  const up = ["a", "b", "c", "d"];
  const down = ["d", "c", "b", "a"];
  up.sort();
  down.sort();
  return up.join("") + down.join("") + String(n % 2);
}
