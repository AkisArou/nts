// A closure over a variable something writes to.
//
// JavaScript closures capture the *binding*, not the value. For a name nothing
// writes to those are the same thing and capturing the value is free, which is
// why that is what happens and why it stays the common case. For a name
// something does write to they differ, and a program can see the difference:
// the variable moves into a one-slot cell on the heap, the enclosing function
// and the closure both hold a pointer to it, and every read and write goes
// through the cell.

function once(f: () => void): void {
  f();
}

function twice(f: () => void): void {
  f();
  f();
}

// The shape the node profile is full of: a guard the callback sets, read by
// the callback and by the function around it.
export function calledOnce(n: number): number {
  let called = false;
  let hits = 0;
  const guard = (): void => {
    if (called) return;
    called = true;
    hits = hits + n;
  };
  twice(guard);
  return hits + (called ? 1000 : 0);
}

// Two closures over one variable, which is the test that the cell is shared
// rather than copied into each.
export function sharedBetweenTwo(n: number): number {
  let total = 0;
  const up = (): void => {
    total = total + 1;
  };
  const down = (): void => {
    total = total - 2;
  };
  once(up);
  once(down);
  once(up);
  return total + n * 0;
}

// ...and that the enclosing function writes the same cell the closure reads.
export function writtenFromBothSides(n: number): number {
  let total = 0;
  const add = (): void => {
    total = total + 10;
  };
  once(add);
  total = total + 1;
  once(add);
  return total + n * 0;
}

// A managed value in the cell, so the cell is a reference field and the
// collector has to walk it.
export function aStringInTheCell(n: number): number {
  let text = "a";
  const grow = (): void => {
    text = text + "b";
  };
  twice(grow);
  return text.length + n * 0;
}

// A parameter, which is a name like any other. `callback = asRequest(callback)`
// before a closure reads it is common enough in the profile that missing this
// emitted C that did not compile.
function throughAParameter(x: number): number {
  x = x + 1;
  let out = 0;
  once((): void => {
    out = out + x;
  });
  return out;
}

export function parameterAssignedThenCaptured(n: number): number {
  return throughAParameter(n);
}

// A `let` in a loop body is a fresh declaration every time round, so it gets a
// fresh cell every time round -- which is what makes `seen` start at zero on
// each iteration while `sum` accumulates across them.
export function aCellPerIteration(n: number): number {
  let sum = 0;
  for (let i = 0; i < 3; i = i + 1) {
    let seen = 0;
    const step = (): void => {
      seen = seen + 1;
      sum = sum + seen;
    };
    twice(step);
  }
  return sum + n * 0;
}

// Capture by *value* is untouched and still allocates no cell: `base` is never
// written, so there is nothing for the two sides to disagree about.
function make(base: number): (x: number) => number {
  return (x) => x + base;
}

export function byValueIsUnchanged(n: number): number {
  return make(n)(1);
}

// A module-scope name is not captured at all. There is one of it for the whole
// program and every function reaches it by name, so a closure carries no copy —
// the same reason a function, a class or an import is not captured. Getting
// this wrong did not produce a wrong answer, it produced a refusal that blamed
// the wrong thing: twelve sites reported a name "from more than one scope up"
// when the name was simply at module scope.
const SCALE = 3;
const TAG = "ab";

function measure(f: () => number): number {
  return f();
}

export function readsModuleScope(n: number): number {
  const local = n * 0;
  return (
    measure((): number => SCALE * 100) +
    measure((): number => TAG.length) +
    measure((): number => SCALE + local)
  );
}

// ...including from a closure inside a closure, which is the case the row was
// named after and which works.
export function readsItFromTwoScopesIn(n: number): number {
  const outer = (): number => {
    const inner = (): number => SCALE + 1;
    return inner();
  };
  return measure(outer) + n * 0;
}

// A closure written *above* the declaration of the local it reads. Legal,
// because the body runs later — and common in the profile, where a handler
// refers to the cleanup function defined below it:
//
//     const onListening = () => { ...cleanup...; };
//     const cleanup = ...;
//
// There is no value to copy where the closure is built, so the name goes
// through a cell whether or not anything writes to it, and the cell is opened
// in the function's entry block: it has to dominate both the closure that reads
// it and the declaration that fills it, and those can sit in different
// branches.
export function readsALaterConst(n: number): number {
  const read = (): number => later;
  const later = n * 2;
  return measure(read) + later * 0;
}

// Two closures either side of the declaration, naming one cell.
export function bothSidesOfTheDeclaration(n: number): number {
  const before = (): number => size + 1;
  const size = n * 3;
  const after = (): number => size + 2;
  return measure(before) + measure(after);
}

// The same, inside a branch, which is what makes the entry block the only
// placement that always dominates.
export function insideABranch(n: number): number {
  if (n > 0) {
    const read = (): number => tag.length;
    const tag = "abc";
    return measure(read);
  }
  return -1;
}
