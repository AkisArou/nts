// `findLast`, `findLastIndex` and `reduceRight` — the same loops, reversed.
//
// Their forward twins all worked, which is what made this an asymmetry rather
// than a feature: `find`, `findIndex` and `reduce` are compiled as a loop with
// the callback's body inlined, and these three are that loop starting at the
// other end and stepping the other way. Nothing else differs — same callback
// shape, same delivery, same seeds, same result.
//
// So the direction is a flag the loop reads in exactly three places — where the
// cursor starts, what stops it, and how it moves — rather than three more
// variants of `Iteration` that every match would have had to say were the same.
//
// # The seeds were already right, and that is not luck
//
// `find` carries the index it stopped at, seeded with the **length**, and
// `findIndex` carries one seeded with **-1**. The comment on the first says why
// it is not -1: `at(-1)` is the *last* element in JavaScript, so a `find` that
// matched nothing would have answered the last element rather than `undefined`.
// Walking backwards changes which index the loop ends on and changes neither
// seed — `findLast` that matches nothing must still answer `undefined`, and
// `findLastIndex` must still answer -1. `matchesNothing` is the arm that fails
// if either were made to follow the direction.
//
// # Why the loop stops with `>= 0` rather than `> -1`
//
// They are the same test, and the second spells it in the constant that also
// means "not found" three functions down. A reader meeting `-1` in this file
// should find exactly one meaning for it.

/** The shape that refused: the *last* match rather than the first. Two 5s, so
 *  an arm that walked forwards would find the wrong one and still return a 5. */
export function lastFive(n: number): number {
  const xs = [1, 5, 2, 5, n];
  return xs.findLast((x) => x === 5) ?? -1;
}

/** The index, which is what separates "found the last" from "found a match":
 *  `lastFive` answers 5 either way and this answers 3 or 1. */
export function lastFiveIndex(n: number): number {
  const xs = [1, 5, 2, 5, n];
  return xs.findLastIndex((x) => x === 5);
}

/** Nothing matches, so the seeds are what answer — `undefined` for the element
 *  and -1 for the index, neither of which follows the direction. */
export function matchesNothing(n: number): number {
  const xs = [1, 2, 3];
  const found = xs.findLast((x) => x > 100 + n * 0) ?? -7;
  return found * 100 + xs.findLastIndex((x) => x > 100);
}

/** `reduceRight` with a seed. The callback is not commutative, so the order is
 *  the whole of what is being checked: `[1, 2, n]` folds to `n2 1` and not
 *  `12n`. */
export function foldFromTheRight(n: number): number {
  const xs = [1, 2, n];
  return xs.reduceRight((a, b) => a * 10 + b, 0);
}

/** `reduceRight` with **no** seed, which takes the *last* element as the
 *  accumulator and walks from the second-to-last — the mirror of `reduce`'s
 *  "first element, walk from the second", and the one arm where the start is
 *  two steps in from the edge rather than one. */
export function foldFromTheRightUnseeded(n: number): number {
  const xs = [1, 2, n];
  return xs.reduceRight((a, b) => a * 10 + b);
}

/** The index parameter, which the callback may take and which must be the
 *  descending one rather than a second count. */
export function lastMatchAfterTheStart(n: number): number {
  const xs = [1, 5, 2, 5, n];
  return xs.findLastIndex((x, i) => x === 5 && i > 0);
}

/** References rather than numbers, so the element read is a pointer load. */
export function lastShortString(n: number): number {
  const xs = ["a", "bb", "ccc", "dd"];
  return (xs.findLast((s) => s.length < 3 + n * 0) ?? "").length;
}

/** Control: the forward twins, on the same data, so the pair can be read
 *  together and a direction applied to the wrong one shows up here. */
export function forwardTwins(n: number): number {
  const xs = [1, 5, 2, 5, n];
  return (xs.find((x) => x === 5) ?? -1) * 100 + xs.findIndex((x) => x === 5);
}

/** Control: `reduce` in both its forms, which share every line of this with
 *  `reduceRight` except the two constants. */
export function forwardFolds(n: number): number {
  const xs = [1, 2, n];
  return xs.reduce((a, b) => a * 10 + b, 0) * 1000 + xs.reduce((a, b) => a * 10 + b);
}

/** Control: the methods with no backwards form at all, which must be untouched
 *  by a flag threaded through the loop they share. */
export function theRestOfTheFamily(n: number): number {
  const xs = [1, 2, n];
  return (
    xs.map((x) => x * 2).length * 1000 +
    xs.filter((x) => x > 1).length * 100 +
    (xs.some((x) => x > 1) ? 10 : 0) +
    (xs.every((x) => x > 0) ? 1 : 0)
  );
}
