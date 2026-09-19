// Parentheses around an assignment target — `(x) = 5`, `(x)++`, `(o.k) = 7`,
// `for ((v) of xs)`.
//
// The grammar's **cover** production, which is why test262 names its files
// `target-cover-id`. Parentheses change nothing about where a write goes, and
// this compiler refused all of it as `assignment to a computed target` — a true
// sentence about the node in front of `place_of` and a false one about the
// program.
//
// Six files of the slice-1 `test/language` population, across assignment, both
// increments, both decrements and a `for...of` head, which is what says the
// unwrap belongs in `place_of` rather than at any one caller: *where a thing
// writes* is one question, and that is the function which answers it. A caller
// that unwrapped for itself would be a second derivation and the next caller
// would not have it — which is exactly how five of those six files came to
// share one refusal.

let counter = 0;

export function parenthesisedName(n: number): number {
  let x = 0;
  (x) = 5;
  return x + n * 0;
}

export function parenthesisedMember(n: number): number {
  const o = { k: 1 };
  (o.k) = 7;
  return o.k + n * 0;
}

export function parenthesisedElement(n: number): number {
  const xs: number[] = [1, 2];
  (xs[1]) = 9;
  return xs[0] * 10 + xs[1] + n * 0;
}

export function postfixIncrement(n: number): number {
  let x = 1;
  (x)++;
  return x + n * 0;
}

export function prefixIncrement(n: number): number {
  let x = 1;
  ++(x);
  return x + n * 0;
}

export function postfixDecrement(n: number): number {
  let x = 1;
  (x)--;
  return x + n * 0;
}

export function prefixDecrement(n: number): number {
  let x = 1;
  --(x);
  return x + n * 0;
}

/** A `for...of` head, which reaches `place_of` through `Head::Assign`. */
export function parenthesisedHead(n: number): number {
  const xs: number[] = [1, 2];
  let v = 0;
  for ((v) of xs) {
    counter = counter + 1;
  }
  return v + n * 0;
}

/**
 * Doubly parenthesised, because an unwrap that ran once would pass every arm
 * above and fail here — and the recursion is free.
 */
export function twiceParenthesised(n: number): number {
  let x = 0;
  ((x)) = 3;
  return x + n * 0;
}

/**
 * The control: the same writes without parentheses. A change that made
 * `place_of` accept anything would pass every arm above and this one too, which
 * is why the arms are *answers* rather than "it compiled".
 */
export function withoutParentheses(n: number): number {
  let x = 0;
  x = 5;
  const o = { k: 1 };
  o.k = 7;
  return x * 10 + o.k + n * 0;
}
