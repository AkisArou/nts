// expect: which is a pointer cast between two structs that do not agree
//         about where their shared fields are
//
// **The diagnosis moved to the assignment on 2026-09-10, and this is the same
// defect named at its cause.** It used to refuse at the *write*, saying `dest`
// is not on `Carrier`. What is actually wrong is one line earlier: `Shaped` is a
// three-field struct and `Carrier implements Shaped` is a two-field one, so
// `const shaped: Shaped = new Carrier(code)` is a pointer cast that widens the
// object, and writing `shaped.dest` writes past the end of what was allocated.
//
// The old message was true and described the symptom. The new one is checked
// rather than assumed: `coerce` emitted a raw pointer cast for every pair of
// object types on the strength of a comment saying base-first layout makes it
// free, which is a fact about a *base* and not about a structural target. The
// unchecked version segfaults where node answers -- measured, on
// `class Thing { id; name }` reaching `interface Named { name }`.
//
// So this fixture reproduces at a different line and for a better stated reason,
// and the observation below -- that the class omits the field on purpose and the
// purpose is observable -- is exactly why the two layouts cannot be one.
//
// An optional property declared on an *interface*, assigned through a reference
// of that interface's type, where the implementing class deliberately does not
// declare it.
//
// Not the same as `computed-member-write`, which is `object[key] = value` with a
// computed key. This is a plain, statically-named assignment that TypeScript
// accepts on its own terms: `shaped` is a `Shaped`, and `Shaped` declares
// `dest?: string`.
//
// The class omits it on purpose, and the purpose is observable. With
// `useDefineForClassFields`, a declared optional field is emitted as an own
// property set to `undefined` -- so `Object.keys(err)` would list `dest` on
// every error that never had one. Node's single-path `fs` errors have exactly
// `code`, `errno`, `path` and `syscall`, and its own tests read that shape. So
// declaring the field to satisfy the compiler changes an answer node's suite
// checks, which makes it a rewrite of correct source to hide a refusal rather
// than a fix.
//
// Reach, measured with `tooling/conformance/cascade-reach.mjs` on 2026-09-08:
// this is `uvException` in `runtime/node/internal/uv.ts`, whose cone is **30
// functions** in the `fs` program.

export interface Shaped {
  code: string;
  path?: string;
  dest?: string;
}

class Carrier implements Shaped {
  code: string;
  path?: string;

  constructor(code: string) {
    this.code = code;
  }
}

export function make(code: string, dest?: string): Shaped {
  const shaped: Shaped = new Carrier(code);
  if (dest !== undefined) {
    shaped.dest = dest;
  }
  return shaped;
}
