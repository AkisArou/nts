// **This was a silent wrong answer on every backend, and it is an example rather than a
// blocker because the fix is the raise being carried rather than the call being refused.**
//
// A method whose body calls a closure held in a **field** got a raising copy, and that
// copy dispatched the closure at the *ordinary* uniform entry -- whose body calls
// `nts_uncaught`. So the `throw` the copy exists to carry ended the program from inside a
// `try` that had compiled:
//
//     nts   guarded 23   nts: uncaught RangeError: from the callback
//     node  guarded 23   -1
//
// 8 of 29 cases of this file, measured on a pin of `8ebd2db87`, with no diagnostic.
//
// # One predicate, four readers, and only one of them knew about parameters
//
// `reason_without_a_leaf` had an arm for a callee declaring a **parameter** -- "a name
// declaring a parameter is a value, whatever the checker found for its type" -- and that
// arm is the whole of what made `call(fn)` work. `const f = this.cb` is the same fact
// about the same call: a function arrives at run time and no walk can say which. Because
// the arm did not cover it, `calls_a_closure` said no, so
// `dispatches_to_a_raising_entry` left the call at the ordinary entry and the raise was
// dropped.
//
// It is now one predicate, `a_value_held_callee`, read by four things that had each
// answered "is this callee a value" their own way:
//
//     reason_without_a_leaf           which sentence, and whether it is a closure call
//     a_call_that_can_raise           whether a copy may hold the call at all
//     a_copy_can_contain              whether the raising uniform entry carries it
//     a_raising_body_carries_this_call   the verifier at the body, which refuses where
//                                        the prediction and the dispatch part company
//
// `throwing_symbols` was right about this all along -- its own classifier calls such a
// callee `Reached::Elsewhere` and treats it as unresolved. Two derivations of one fact,
// and the one with fewer readers was the wrong one.
//
// # Where it still refuses, and that is the control this file cannot hold
//
// Carrying the raise needs the raising uniform entry, so it needs
// `Naming::closures_carry` -- the program-global gate. Turn the gate off (a closure whose
// own body constructs a program class that can throw is enough) and the same program
// refuses instead, by name. That cannot be an arm here, because the gate is a property of
// the **program**: a file holding both would have the gate off for all of it. The probe
// lives in the commit message; `blockers/a-callback-held-in-a-field-with-the-gate-off`
// would be the fixture if the gate ever stops being program-global.
//
// # The corpus witness, one frame deeper than this reduction
//
// `runtime/node/stream`'s `DuplexSide`, found by the JVM lane:
//
//     override _read(): void { this.release(); }
//     release(): void {
//       const callback = this.#callback;
//       if (callback) { this.#callback = null; callback(); }
//     }
//
// It is also why the overridden-member raising slot could not land first: its "an
// override that cannot raise needs no copy" arm would have filled `DuplexSide`'s slot
// with that ordinary body, planting an escape that an unrelated fix to `Readable#read`
// would have made live.

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
held.cb = (n: number): number => {
  if (n > 5) {
    throw new RangeError("from the callback");
  }
  return n * 4;
};

/** Refused: `run` calls a closure held in a field, so no copy of it can be made. */
export function guarded(n: number): number {
  try {
    return held.run(n & 7);
  } catch {
    return -1;
  }
}

/**
 * The control, and it must go on compiling: the same `try` and the same `throw`,
 * reached through a callee that is a **declaration** this compiler can ask rather
 * than a value it cannot. A rule that refused every `try` around a call would
 * satisfy the expectation above and break this.
 */
export function writtenAtTheCall(n: number): number {
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

/**
 * The second control: the field-held call with **no** `try` around it. Nothing has
 * to be carried, so nothing is refused.
 */
export function outsideATry(n: number): number {
  return held.run(n & 3);
}
