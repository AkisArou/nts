// `a ||= b`, `a &&= b`, `a ??= b` — a test, and a write that happens only when
// the test says so.
//
// The spelling puts these next to `+=`, and the lowering deliberately does not.
// `a += b` always writes. These write on one path and not the other, and the
// difference is observable rather than academic: a setter does not run, and a
// counted store does not release the value the place was already holding. So
// the write goes *inside* the branch, and `a = a || b` is the wrong desugaring
// however much it looks like the right one.
//
// `??=` is not a narrower `||=`. They ask different questions and disagree on
// every falsy value that is present — `0`, `""`, `NaN`. `orAndNullishDiffer`
// below is that disagreement, and the argument pool supplies the zeros.
//
// The target is lowered once, before the test. `xs[nextIndex()] ||= 5` calls
// `nextIndex` a single time in JavaScript, whichever way the test goes, and
// `indexEvaluatedOnce` counts the calls rather than trusting it.

// --- the three tests on a value that is never absent ---------------------

// `0`, `-0` and `NaN` are all falsy, so the pool's zeros and its NaN take the
// writing path here and the keeping path in `nullishOnNeverAbsent`.
export function orKeepsTruthy(n: number): number {
  let x = n;
  x ||= 99;
  return x;
}

export function andWritesOnTruthy(n: number): number {
  let x = n;
  x &&= x + 1;
  return x;
}

// A `number` has no room for an absence, so there is nothing to test and
// nothing is ever written. That is what the specification says happens rather
// than an optimization of it — TypeScript permits the shape and reports it as
// unnecessary.
export function nullishOnNeverAbsent(n: number): number {
  let x = n;
  x ??= 99;
  return x;
}

// The disagreement, in one function: `a` is overwritten because zero is falsy,
// `b` is kept because zero is present.
export function orAndNullishDiffer(n: number): number {
  let a: number = n * 0;
  let b: number = n * 0;
  a ||= 5;
  b ??= 5;
  return a * 10 + b;
}

// --- a target that can actually be absent ---------------------------------

export function nullishOnAbsent(n: number): number {
  let x: number | undefined = n > 2 ? n : undefined;
  x ??= -1;
  return x;
}

// `null` and `undefined` are one absence in a compiled program, so the same
// test answers for a nullable target.
export function nullishOnNull(n: number): number {
  let x: number | null = n > 2 ? n : null;
  x ??= -2;
  return x;
}

// `||=` on an absent target writes for a second reason: absent is also falsy.
export function orOnAbsent(n: number): number {
  let x: number | undefined = n > 2 ? n : undefined;
  x ||= -3;
  return x;
}

// `&&=` keeps its value where it is *falsy*, and `undefined` is falsy — so the
// kept arm here is the absent one, which is why that arm may not be read back
// at the narrowed type.
export function andOnAbsent(n: number): number {
  const x: number | undefined = n > 2 ? n : undefined;
  let y: number | undefined = x;
  y &&= 8;
  return y ?? -4;
}

// --- the right operand is not evaluated when the test keeps the target -----

let calls = 0;

function bump(n: number): number {
  calls += 1;
  return n + 1;
}

export function rightOperandNotEvaluated(n: number): number {
  calls = 0;
  let x = n > 2 ? 5 : 0;
  x ||= bump(n);
  return calls * 100 + x;
}

export function nullishRightOperandNotEvaluated(n: number): number {
  calls = 0;
  let x: number | undefined = n > 2 ? 5 : undefined;
  x ??= bump(n);
  return calls * 100 + x;
}

// --- the target is evaluated once -----------------------------------------

function nextIndex(n: number): number {
  calls += 1;
  return n > 0 ? 0 : 1;
}

// Two calls here rather than one would show up as `200`, which is the failure
// a desugaring through `a = a || b` produces.
export function indexEvaluatedOnce(n: number): number {
  calls = 0;
  const xs: number[] = [0, 0];
  xs[nextIndex(n)] ||= 5;
  return calls * 100 + xs[0] * 10 + xs[1];
}

// --- through a field ------------------------------------------------------

type Counter = { hits: number; label: string };

export function throughAField(n: number): number {
  const c: Counter = { hits: n * 0, label: "c" };
  c.hits ||= n + 1;
  return c.hits;
}

export function andThroughAField(n: number): number {
  const c: Counter = { hits: n, label: "d" };
  c.hits &&= c.hits * 2;
  return c.hits;
}

// --- through an element ---------------------------------------------------

export function throughAnElement(n: number): number {
  const xs: number[] = [n * 0, n];
  xs[0] ??= -5;
  xs[1] ||= -6;
  return xs[0] * 10 + xs[1];
}

// --- on a managed value ---------------------------------------------------

// The empty string is falsy, so `||=` writes; the target is a pointer rather
// than a tagged value, and the store is the one that has to release what was
// there under reference counting.
export function onAString(n: number): number {
  let s: string = n > 2 ? "abc" : "";
  s ||= "fallback";
  return s.length;
}

export function nullishOnAString(n: number): number {
  let s: string | undefined = n > 2 ? "abc" : undefined;
  s ??= "fallback";
  return s.length;
}

// --- a conditional write inside a loop ------------------------------------

// The loop header needs a parameter for `seen` even though the body writes it
// on only one path. A write the collector misses is not a wrong answer, it is
// a loop that reads its entry value forever.
export function inALoop(n: number): number {
  let total = 0;
  let seen: number | undefined = undefined;
  for (let i = 0; i < 4; i++) {
    seen ??= i + n;
    total += seen;
  }
  return total;
}

// The same shape where the test can go either way across iterations: `acc`
// stays falsy until `i + n` is not zero.
export function orInALoop(n: number): number {
  let acc = 0;
  for (let i = 0; i < 3; i++) {
    acc ||= i + n;
  }
  return acc;
}

// --- captured by a closure ------------------------------------------------

// The binding is a cell, so the write is a store into it rather than a new
// binding — the closure and the enclosing function have to see the same one.
export function capturedByAClosure(n: number): number {
  let x: number | undefined = n > 2 ? n : undefined;
  const fill = (): void => {
    x ??= -7;
  };
  fill();
  return x ?? 0;
}

// --- through a global -----------------------------------------------------

let stored: number | undefined = undefined;

// The value of the assignment rather than a read-back of the slot. Reading a
// *narrowed* global is a separate refusal that has nothing to do with this
// operator -- the slot holds an erased value, TypeScript narrows `stored` to
// `number` the moment the write is past, and the lowering has no unerase
// there. `let v = (stored ??= -9)` compiles and `return stored` does not, which
// is how you can tell the two apart.
export function throughAGlobal(n: number): number {
  stored = n > 2 ? n : undefined;
  return (stored ??= -9);
}
