// `"a-b-c".split("-")` in a program that **grows** an array somewhere.
//
// On the JVM a growable program holds every array as an `NtsArrayL` wrapper
// rather than a bare Java array — that is what `shape.grows` means — and a
// runtime helper that returns a bare `[Ljava/lang/String;` was stored into a
// slot typed as the wrapper. It threw at run time:
//
//     ClassCastException: class [Ljava.lang.String; cannot be cast to
//                         class nts.rt.NtsArrayL
//
// Not a refusal. C and LLVM agree with node on the same program, and both pass
// a pointer and ask nothing about it — only a backend that names the type it is
// storing into can notice.
//
// **`nts_str_split` is the only helper this reaches, and that was measured
// rather than reasoned about.** Every array-producing operation was tried one
// at a time under a grown array: `slice`, `concat`, `splice`, `reverse`, `map`,
// `filter`, `Array.from`, `Object.keys`, `Object.values`, `toReversed`,
// `toSorted` — all already answered a wrapper.
//
// The `grown` array in each export is doing the work of a flag: it never
// interacts with the split, and without it the program is not growable and
// nothing wraps. Growability is decided for the whole program, so a `push`
// anywhere is what puts every array into a wrapper — which is why this defect
// needed two unrelated pieces of a program to meet.

/** The shape that threw. */
export function splitBesideAGrownArray(n: number): number {
  const grown: number[] = [];
  grown.push(n % 5);
  const parts = "a-b-c".split("-");
  return parts.length * 10 + grown.length;
}

/** The elements read back, not only the length — a wrapper whose storage was
 *  adopted must hand back the same strings. */
export function splitElements(n: number): string {
  const grown: number[] = [];
  grown.push(n % 5);
  const parts = ("x-y-" + String(((n % 3) + 3) % 3)).split("-");
  return parts[0]! + parts[2]! + String(parts.length);
}

/** The wrapper has to behave like an array afterwards, so the result is walked
 *  and indexed rather than only measured. */
export function splitThenWalk(n: number): number {
  const grown: string[] = [];
  grown.push(String(((n % 3) + 3) % 3));
  const parts = "1-2-3-4".split("-");
  let total = 0;
  for (const p of parts) {
    total += p.length;
  }
  return total * 10 + parts.length + grown.length;
}

/** And grown itself, which is the case the wrapper exists for. */
export function splitThenPush(n: number): number {
  const parts = "a-b".split("-");
  parts.push(String(((n % 3) + 3) % 3));
  return parts.length * 10 + parts[2]!.length;
}

/** Control: the same split with **no** grown array anywhere, which is not a
 *  growable program and never wrapped. It lowered before and must still. */
export function splitWithNothingGrown(n: number): number {
  const parts = "a-b-c".split("-");
  return parts.length + n * 0;
}

/** Control: the array-producing operations that already answered a wrapper,
 *  beside a grown array — the arm that says the fix did not disturb them. */
export function theOnesThatAlreadyWrapped(n: number): number {
  const grown: number[] = [];
  grown.push(n % 5);
  const sliced = [1, 2, 3].slice(1);
  const mapped = [1, 2].map((x) => x * 2);
  const joined = [4, 5].concat([6]);
  return sliced.length * 100 + mapped.length * 10 + joined.length + grown.length;
}
