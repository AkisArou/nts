// The json-scan shape, reduced: a number scanner reads the same index of
// the same string several times, because that is how the source is
// written (runtime/web-platform's parse.ts `scanNumber` tests the sign,
// then zero, then digit-ness, then loops on digit-ness, each a fresh
// `charCodeAt`).
//
// Strings are immutable, so a repeated unit read of one index is the
// same read, and a string's length is fixed for its lifetime. Node's JIT
// folds them; the HIR did not — measured (2026-10-19, counting mode):
// json-scan pays 205,648 instructions/op on Wasm against node's 48,043,
// with scanNumber 76% of Wasm self time and roughly 51 host instructions
// per unit read against node's 12. `hir::cse` now makes a dominated
// unit read or string length the read that dominates it, which every
// backend inherits.
//
// `classify` is three reads of one index, each after the join of the
// test before it. `integerPart` is parse.ts's own form: the zero test,
// and in its else arm the digit test of the same index. `remaining`
// reads a string's length to guard and again to answer. `grown` is the
// control: an array's length is not a read, because the `push` between
// the two moves it, so both stay (and folding them would answer 0 where
// node answers 1).
//
// `scanNumber`'s duplicate is the pre-loop digit test against the loop
// condition, a partial redundancy: every read there is at a different
// index value, and carrying the loop's read in a block parameter would
// move a read to the back edge rather than remove one, so no static
// count says it. Its evidence is the counted rows, not a fact here; it
// stays as an agreement arm.
//
// expect-ir: all: count str.unit in classify == 1
// expect-ir: all: count str.unit in integerPart == 1
// expect-ir: all: count array.len in remaining == 1
// expect-ir: all: count array.len in grown == 2

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** The index just past the number at `from`, or -1 when there is none. */
export function scanNumber(source: string, from: number): number {
  let at = from | 0;
  if (source.charCodeAt(at) === 45) at = (at + 1) | 0;
  if (!isDigit(source.charCodeAt(at))) return -1;
  while (isDigit(source.charCodeAt(at))) at = (at + 1) | 0;
  return at;
}

/** Three straight-line reads of one index of one string. */
export function classify(source: string, where: number): number {
  const at = where | 0;
  let score = 0;
  if (source.charCodeAt(at) === 45) score = (score + 1) | 0;
  if (isDigit(source.charCodeAt(at))) score = (score + 2) | 0;
  if (source.charCodeAt(at) >= 48) score = (score + 4) | 0;
  return (score + source.length) | 0;
}

/** The index past a leading zero or one digit at `from`, or -1 when neither is there. */
export function integerPart(source: string, from: number): number {
  let at = from | 0;
  if (source.charCodeAt(at) === 48) {
    at = (at + 1) | 0;
  } else {
    if (!isDigit(source.charCodeAt(at))) return -1;
    at = (at + 2) | 0;
  }
  return at;
}

/** How many units of `source` lie at or after `from`. */
export function remaining(source: string, from: number): number {
  const at = from | 0;
  if (at >= source.length) return 0;
  return (source.length - at) | 0;
}

/** How far a `push` moves an array's length. */
export function grown(values: number[], extra: number): number {
  const before = values.length;
  values.push(extra);
  return (values.length - before) | 0;
}

export function work(seed: number): number {
  const source = "-42 and 4096 or 0x";
  const at = seed & 3;
  const tail = integerPart(source, at) + remaining(source, at) + grown([at, seed], at);
  return (scanNumber(source, at) + classify(source, at + 1) + tail) | 0;
}
