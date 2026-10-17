// run: check
// Existing defect on clean main 547480416 and corrected entry pin 11e345b96:
// pre-binding undefined to an optional string gives invalid HIR (StoreType,
// expected Managed(String), found Managed(Array(Erased))) on all four backends.
// Node returns 7. The one-change control pre-binds "abc" instead of undefined:
// tests/programs/a-prebound-optional-string-keeps-its-value, 29/29 on all four
// backends under both pins. The defect remains outside checked-entry work.
function text(x?: string): number { return x === undefined ? 7 : x.length; }
export function subject(n: number): number {
  const f = text.bind(undefined, undefined);
  return f();
}
