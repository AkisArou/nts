// run: check
//
// **FIXED by `188141404` (#42: carry exceptions through generic and structural
// function copies) and kept as a guard.** A `try` around a plain hop to a
// generic function that throws was refused, and now compiles and catches.
//
// It was a blocker, `expect: ... \`boomGeneric\`, a generic, whose copy suffix
// already names its instantiation`, and its header called this a standing gap:
// a copy is identified by `(declaration, suffix)` and a generic's suffix was
// already spoken for by its instantiation. #42 makes the raising form part of
// the specialization's identity instead, so a generic *function* declaration
// has a raising copy per instantiation. A generic *method* is still excluded:
// `blockers/a-callback-held-in-a-field-with-the-raising-gate-off` holds that
// branch.
//
// What this guards is that the two arms stay one answer: `viaGeneric` and the
// control `viaPlain` both reach their handler and return -1 where node does.

/** The leaf. A generic that throws, so no raising copy can be made of it. */
function boomGeneric<T>(value: T): T {
  if (value !== undefined) {
    throw new Error("generic");
  }
  return value;
}

/** One plain hop, so the refusal has to walk rather than read the call in front of it. */
function middle(n: number): number {
  return boomGeneric(n);
}

/** The subject: the `try` cannot be given a handler edge, and says which leaf. */
export function viaGeneric(n: number): number {
  try {
    return middle(n);
  } catch {
    return -1;
  }
}

/**
 * The control, and it compiles: the same hop to a thrower that is **not** generic,
 * so a raising copy exists and the `try` gets its handler. Without this arm a
 * regression that refused every `try` over a hop would read exactly like the
 * blocker.
 */
function boomPlain(n: number): number {
  if (n >= 0) {
    throw new Error("plain");
  }
  return n;
}

function middlePlain(n: number): number {
  return boomPlain(n);
}

export function viaPlain(n: number): number {
  try {
    return middlePlain(n);
  } catch {
    return -1;
  }
}
