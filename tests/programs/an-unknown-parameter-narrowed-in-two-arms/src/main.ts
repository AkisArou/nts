// `unerase::narrow_parameters` gives an erased parameter the representation its
// callers agree on, when every use would unwrap it anyway. A `typeof` chain
// unerases the same parameter once per arm -- to `f64` in one and to
// `managed<str>` in the next -- and `unwrap_uses` made **every** unerase of a
// narrowed value the identity, so the string arm's became the `f64` itself:
//
//     error: passing 'double' to parameter of incompatible type
//            'const NtsString *'      (nts_concat)
//
// `emit-c` exited 0 and `cc` refused the program. The guard is that an unerase
// has to want what the callers agreed on; the other arm is statically dead --
// `TagOf` folds to a constant and the test beside it compares two constants --
// but nothing folds that comparison, so the block survives to be emitted, and a
// pass may not rest on a later one it does not run.
//
// Pinned by the conformance lane as
// `outcomes/an-unknown-narrowed-by-typeof-called-with-one-type`. This is the
// pair: the arm that must keep being narrowed beside the arm that must not.

/**
 * The population the pass exists for: one unerase, one representation, one
 * caller. Its parameter is still `f64` in the prepared HIR, which is the whole
 * point of the pass -- a tag test and an unerase per call, removed.
 */
function doubled(value: unknown): number {
  return typeof value === "number" ? value * 2 : 0;
}

/**
 * The guard's arm: two unerases that disagree, so the parameter stays erased.
 * On a compiler without the guard this function is the uncompilable C above.
 */
function described(value: unknown): string {
  if (typeof value === "number") {
    return "n" + String(value);
  }
  if (typeof value === "string") {
    return "s" + value;
  }
  return "other";
}

export function useBoth(n: number): number {
  return doubled(n) + described(n).length;
}

/** The control: two callers of different types, so nothing is narrowed at all. */
export function useWithTwoTypes(n: number): number {
  return described(n).length + described("x").length + doubled(n);
}
