// An array literal the checker typed `never`, which is not a gap but an answer.
//
// `[]` is `never[]` and `[[]]` is `never[][]`. Three sources decide what an
// array literal holds — its own type, the slot expecting it, and its contextual
// type — and for these there is nothing for any of them to say. That was refused
// as *"an empty array literal in a position that does not say what it holds"*,
// which read as a missing case and is not one: **no value of type `never`
// exists**, so no program can read an element out of either. A read has type
// `never` and the checker refuses every use of it, so the element's width is
// unobservable and refusing for want of one refuses a program that could not
// have told the difference.
//
// `suspend::yielded_slot` had already made exactly this choice for exactly this
// reason — a generator that yields nothing still needs a slot with a width,
// "sound because nothing can read it" — so the stand-in here is the same
// `HirType::NUMBER` rather than a second answer to one question.
//
// 15 files of the slice-1 `test/language` population: 12 `for (… of [[]])` with
// a destructuring head, and 3 a bare `[];` whose value is discarded.
//
// # The controls, and what they are controlling for
//
// The case where a width *would* be observable is an **evolving** array:
// `const xs = []; xs[0] = "s"` must build an array of strings. It cannot reach
// the stand-in, because an evolving array gives the *variable* a type and the
// literal is lowered against that — so `evolvesToNumbers` and `evolvesToStrings`
// below already lowered before the stand-in existed and still must. An example
// whose every arm moves cannot show that a fix left the working path alone.
//
// Two neighbours deliberately left refusing, because they are a different
// question with the same shape. `const xs = []; return xs.length` is `any[]`
// rather than `never[]` — the checker declining to infer, not declaring
// emptiness — and `for (const [{ q = 3 } = {}] of [[]])` refuses one step later
// with *"destructuring something with no fields"*, which this uncovered rather
// than caused.

/** A bare `[];` — the value is discarded, so nothing ever holds it. */
export function aDiscardedLiteral(n: number): number {
  [];
  {
  }
  [];
  return n;
}

/** `for ([] of [[]])` — the 12-file shape, iterating empty arrays. */
export function iteratesEmptyArrays(n: number): number {
  let counter = 0;
  for ([] of [[], [], []]) {
    counter += 1;
  }
  return counter * 10 + n * 0;
}

/**
 * A destructuring head whose default fires because the array is empty.
 *
 * Distinct from the arm above: there the pattern binds nothing, here it binds a
 * name whose initializer must run, so the empty array is read from as well as
 * iterated.
 */
export function takesADefaultFromNothing(n: number): number {
  let total = 0;
  for (const [a = 5] of [[], []]) {
    total += a;
  }
  return total + n * 0;
}

/** `[[]]` in a function — `never[][]`, which has no representation at all. */
export function anArrayOfEmptyArrays(n: number): number {
  const xs = [[]];
  return xs.length * 10 + xs[0].length + n * 0;
}

/** Control: an evolving array of numbers, which must keep its own width. */
export function evolvesToNumbers(n: number): number {
  const xs = [];
  xs[0] = n;
  xs[1] = n + 1;
  return xs[0] * 10 + xs[1];
}

/**
 * Control: an evolving array of strings, where a wrong width is observable.
 *
 * Built with `push` rather than `xs[0] = "ab"`, and the difference is a bug this
 * example found rather than a style choice. **A growing index write works for a
 * scalar element and aborts for a counted one** —
 *
 *     nts: refused: index 0 is outside [0, 0)
 *
 * — across ten arms: number and boolean grow, string, object and array abort,
 * annotated or evolving, empty or not. `push` grows all of them, so the runtime
 * can do it and only the index-write path cannot.
 *
 * `array_write_may_grow` says why, honestly: `rc.rs` pairs a counted store with a
 * load of what the slot held so the old reference can be released, and at
 * `index == length` there is no such slot, so "a counted element keeps today's
 * abort". Pre-existing — identical on the binary at 23666c14 — and filed as
 * `blockers/a-growing-write-of-a-counted-element`, because a documented
 * limitation that arrives as a runtime abort with no diagnostic is the one
 * failure mode a caller cannot act on.
 */
export function evolvesToStrings(n: number): number {
  const xs = [];
  xs.push("ab");
  xs.push("cde");
  return xs[0].length * 10 + xs[1].length + n * 0;
}
