// expect: nothing refused -- FIXED, kept as a regression guard
//
// An annotated `const` whose initializer is narrower than the annotation, then
// written through. This refused until the compiler lane repaired it at the
// allocation site rather than at the write, and it gated every module in the
// profile through `internal/errors.ts`.
//
// Kept because the repair had a second half: laying the object out as the
// declared type gave it that type's descriptor, and `instanceof` was walking a
// narrower relation than the one being recorded. If this fixture ever refuses
// again, or `widen` stops returning "x", that is the same bug returning.
interface Tagged extends Error {
  code?: string;
}

export function widen(m: string, c: string): string {
  const w: Tagged = new Error(m);
  w.code = c;
  return w.code ?? "";
}
