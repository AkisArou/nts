// A rest parameter written as a union of tuples whose positions **disagree**.
//
//     constructor(...given: [] | [input: string, base?: string | URL])
//
// That is `URL#constructor`. Position 0 is `string` and position 1 is
// `string | URL | undefined`, and no single concrete element is both -- which
// is why `examples/a-rest-parameter-written-as-a-union-of-tuples` stops at the
// agreeing case and this one exists.
//
// The element is *erased*, the call site erases each argument into the array,
// and a read at a constant index comes back as the type that position was
// declared with. The license for that unerase is stronger than a narrowing:
// position `k` is declared once per arm, the call site erased exactly the
// argument written there, and every arm that has a `k` agrees about it.
//
// Agreeing positions keep their concrete element and pay no tag test, which is
// what `controlHomogeneous` holds down -- an erased array costs about 11%
// against a typed one.

class Tag {
  x: number;
  constructor(n: number) {
    this.x = n;
  }
}

/** `URL`'s shape: a scalar position and an object position. */
function mixed(...given: [] | [a: number, b?: Tag]): number {
  if (given.length === 0) return -1;
  if (given.length < 2) return given[0];
  return given[0] + given[1]!.x;
}

/** A string position beside an object one, which is `URL`'s literally. */
function stringAndObject(...given: [] | [a: string, b?: Tag]): number {
  if (given.length === 0) return -1;
  if (given.length < 2) return given[0].length;
  return given[0].length + given[1]!.x;
}

/**
 * **A bare tuple, with no union around it.**
 *
 * `[a: number, b: string]` is the same question with one arm, and it was
 * refused for not being a union while `[] | [a: number, b: string]` lowered —
 * one construct, and the *presence of an alternative* deciding whether it
 * worked.
 *
 * A *scalar beside a reference* on purpose. Two other bare tuples never reach
 * this path at all: a homogeneous one, because the checker already answers
 * `Array` for it, and one whose positions are **all managed** — `[string, Tag]`
 * — because those represent as `Array(first)` deliberately, with `element_of`
 * restoring the declared type on the way out. Writing this case with an object
 * position instead tested that older rule and not this one.
 */
function bareTuple(...given: [a: number, b: string]): number {
  return given[0] + given[1].length;
}

/** Control: positions that agree keep a concrete element. */
function homogeneous(...given: [] | [a: number] | [a: number, b: number]): number {
  if (given.length === 0) return -1;
  if (given.length < 2) return given[0];
  return given[0] + given[1]!;
}

export function mixedByArity(n: number): number {
  return mixed() * 100 + mixed(n & 3) * 10 + mixed(n & 3, new Tag(2));
}

export function stringPosition(n: number): number {
  const s = (n & 1) === 0 ? "ab" : "cde";
  return stringAndObject() * 100 + stringAndObject(s) * 10 + stringAndObject(s, new Tag(1));
}

export function controlHomogeneous(n: number): number {
  return homogeneous() * 100 + homogeneous(n & 3) * 10 + homogeneous(n & 3, 4);
}

/**
 * The count is the number of arguments supplied, not the number that are not
 * `undefined` -- which is what `URLSearchParams#delete` distinguishes with
 * `given.length < 2`.
 */
export function bareTuplePositions(n: number): number {
  return bareTuple(n & 3, (n & 1) === 0 ? "ab" : "cde");
}

export function countIsArity(n: number): number {
  return mixed(n & 1) + 100 * (mixed(n & 1, new Tag(0)) - (n & 1));
}
