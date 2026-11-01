// A class nothing makes keeps no printer. Nothing calls `never`, so no
// `RangeError` exists at run time. The live `throw new Error(...)` hands the
// runtime an `Error`, which may be any class deriving from it, and that kept
// the `toString` of every such class -- the runtime prints an object by its
// descriptor's. C emits no descriptor for a class nothing makes, so
// `RangeError`'s was a `static` nothing calls, refused under `-Werror`.
// Checked by the C backend's `execute` tests, with the control
// `a-class-nothing-makes-keeps-no-printer-control` beside this one, where
// `never` is called.
function never(): number {
  throw new RangeError("never thrown");
}

export function checked(n: number): number {
  if (n < 0) throw new Error("negative");
  return n;
}
