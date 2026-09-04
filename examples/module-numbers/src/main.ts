// What a module-scope number can hold, and what it must not be assumed to.
//
// A number lives in one of three places: a local, a field, or a global.
// `hir::fields` says what a field holds and `hir::elements` what an array's
// elements hold; a global had neither, so every read of one was TOP — and a TOP
// in a loop makes every operation after it floating point, whatever the slot
// actually contains.
//
// `hir::globals` is the missing third. The join over every store, plus the
// declaration's starting value, is what any read can see, because nothing else
// can write a global: there is no FFI writing through a pointer here and every
// store is a `GlobalSet` in the HIR.
//
// The interesting half of this file is the second half. Facts about a global
// are only worth having if they are *true*, and the cases below are the ones
// where the obvious fact is false: a fraction, a NaN, a negative zero, a value
// past what an `int32` holds, and one past what a `double` can tell apart.

// --- The case it is for -------------------------------------------------

// A counter. Every store is a small whole number, so the slot is an `int32`
// and the arithmetic around it never leaves a register.
//
// Accumulated in a local and stored once, because assigning a module-scope name
// *inside* a loop is refused today — "a loop assigning a name declared outside
// it". That refusal is unrelated to this analysis and older than it, but it is
// worth knowing it is there: the shape this file could not use is the shape a
// counter usually has.
let counter = 0;

export function counts(n: number): number {
  const times = n > 0 && n < 500 ? n | 0 : 17;
  let running = 0;
  for (let i = 0; i < times; i++) {
    running = running + i;
  }
  counter = running;
  return counter;
}

// Read inside a hot loop, which is the shape the benchmark measures: the read
// is what used to poison everything after it.
let step = 0;

export function reads(n: number): number {
  step = n | 0;
  let total = 0;
  for (let i = 0; i < 64; i++) {
    total = (total ^ (((i * 2654435761) ^ (i >>> 3)) + step)) | 0;
  }
  return total;
}

// Negative is still whole and still fits.
let swing = 0;

export function goesNegative(n: number): number {
  swing = -(n | 0);
  swing = swing - 1;
  return swing;
}

// --- The cases it must decline ------------------------------------------

// A fraction. An integer slot would round it, and the answer would change.
let ratio = 0;

export function keepsAFraction(n: number): number {
  ratio = n / 4;
  return ratio * 8;
}

// NaN. `0 / 0` is not a whole number and is not any integer.
let maybeNan = 0;

export function keepsNaN(n: number): number {
  maybeNan = n === 0 ? 0 / 0 : n | 0;
  // `NaN !== NaN`, so this reports which one it got without printing it.
  return maybeNan === maybeNan ? 1 : 2;
}

// Negative zero, which is the sharpest of the five: an `int32` slot cannot hold
// it, `-0 === 0` is true so equality cannot tell, and `1 / -0` is -Infinity so
// division can. A pass that narrowed this would be wrong in a way only one
// operator in the language can see.
let signedZero = 0;

export function keepsNegativeZero(n: number): number {
  // Written as a choice between two literals rather than as `n * 0`, and that
  // is not a stylistic preference. `n * 0` is `NaN` when `n` is an infinity, so
  // the analysis refuses it for being possibly-NaN and the negative-zero rule
  // is never consulted — a mutation removing that rule changed nothing, which
  // is how the first version of this case was found to be testing air.
  signedZero = n < 0 ? -0 : 0;
  const reciprocal = 1 / signedZero;
  return reciprocal < 0 ? 1 : 2;
}

// Past what an `int32` holds. Still whole, so it can be held narrower than a
// double — but not in 32 bits.
let wide = 0;

export function beyondInt32(n: number): number {
  wide = (n | 0) * 4294967296;
  return wide / 4294967296;
}

// Past what a `double` can tell apart. There is nothing to prove here: beyond
// 2^53 adjacent integers are the same double, so no integer width represents
// what this holds.
let huge = 0;

export function beyondSafeIntegers(n: number): number {
  huge = (n | 0) * 1e15;
  return huge / 1e15;
}

// Infinity is not in any integer range.
let unbounded = 0;

export function keepsInfinity(n: number): number {
  unbounded = n === 0 ? 1 / 0 : n | 0;
  return unbounded > 1e308 ? 1 : 2;
}

// --- Where the analysis has to stop -------------------------------------

// Exported, so a reader outside the compiled set holds the declared type.
// Every store here is a small whole number and it still must not narrow: the
// facts are about this program, and `exported` means the program is not all of
// it.
export let visible = 0;

export function writesTheExported(n: number): number {
  visible = n | 0;
  return visible;
}

// Read before anything stores into it, which is what the declaration's starting
// value is for. `first` is read by a function that may run before the one that
// writes it, so zero is part of the join whether or not the writer ran.
let first = 0;
let second = 0;

function record(n: number): void {
  first = n | 0;
}

export function readsBeforeWriting(n: number): number {
  second = first;
  record(n);
  return second + first;
}
