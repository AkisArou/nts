// run: check
//
// **The program `blockers/a-callback-held-in-a-field-with-the-raising-gate-off`
// held until #42, which now compiles and agrees.** A closure held in a class
// field calls `pick<T>`, a generic *function* that can throw, and a method calls
// that closure inside a `try`. Before `188141404` a generic function had no
// raising copy, so this closure turned the program-global raising gate off and
// the `try` was refused; with #42 the copy exists, the gate stays on, and the
// throw reaches the handler.
//
// That blocker keeps the refusal branch with a generic *method* as its
// trigger, which #42 still excludes. This file is its other half: the shape
// that branch used to cover, now a guard that it stays compiled and correct.
// Without the raising copy this program was once a silent wrong answer
// (`uncaught RangeError` where node answers -1), so a regression here could be
// silent again.
//
// The control is the blocker's own: a callee that is a declaration, whose
// raising copy is named directly.

function pick<T>(value: T, deep: boolean): T {
  if (deep) {
    throw new RangeError("generic");
  }
  return value;
}

class Holder {
  cb: ((n: number) => number) | null = null;
  run(n: number): number {
    const f = this.cb;
    if (f) {
      return f(n);
    }
    return n * 3;
  }
}

const held = new Holder();
held.cb = (n: number): number => pick(n, n > 5);

/** The subject: a closure held in a field calls a throwing generic, under a `try`. */
export function guarded(n: number): number {
  try {
    return held.run(n & 7);
  } catch {
    return -1;
  }
}

/** The control: a callee that is a declaration, so its raising copy is named directly. */
export function throughADeclaration(n: number): number {
  try {
    return made(n & 7);
  } catch {
    return -1;
  }
}

function made(n: number): number {
  if (n > 5) {
    throw new RangeError("from the function");
  }
  return n * 4;
}
