// A `function*` **expression** is a generator, and `begin_generator` had two
// callers: `lower_function` and the method path. `lower_closure` was the third
// and did not ask, so the body was lowered as an ordinary function and every
// `yield` in it said "a `yield` outside a generator" -- true of the lowering and
// false of the source.
//
// The comment at the second call site records the same discovery for *methods*
// ("`begin_generator` had one caller, `lower_function`, so a `*named()` ...
// reached its body with no frame reserved"). This is the third time one lowering
// path of three missed a per-function `begin_*`, which is why the fix is the call
// the other two already make rather than a clause of its own.
//
// The conformance lane counts **460 of the corpus's ~800 no-verdict rows** behind
// it: `FellThrough { func: "Closure0#call" }` where the body was lowered as an
// ordinary function, and "a `yield` outside a generator" where it was not. Every
// `dstr/` test in test262 builds its iterator this way -- `var iter =
// function*() { yield 1; }()`.

/** The reported shape: a `function*` expression bound to a name. */
const make = function* (): Generator<number> {
  yield 1;
  yield 2;
};

export function viaExpression(n: number): number {
  let total = 0;
  for (const value of make()) {
    total += value;
  }
  return total + n;
}

/** Invoked where it is written, which is how test262 spells it. */
export function viaImmediateCall(n: number): number {
  let total = 0;
  for (const value of (function* (): Generator<number> {
    yield 10;
    yield 20;
  })()) {
    total += value;
  }
  return total + n;
}

/**
 * An object literal's generator method, which `collect_closures` takes as a
 * closure for the same reason an arrow is one -- so it reached the same path.
 */
const held = {
  *pair(): Generator<number> {
    yield 3;
    yield 4;
  },
};

export function viaLiteralMethod(n: number): number {
  let total = 0;
  for (const value of held.pair()) {
    total += value;
  }
  return total + n;
}

/** The control: the same generator as a declaration, which compiled all along. */
function* declared(): Generator<number> {
  yield 1;
  yield 2;
}

export function viaDeclaration(n: number): number {
  let total = 0;
  for (const value of declared()) {
    total += value;
  }
  return total + n;
}
