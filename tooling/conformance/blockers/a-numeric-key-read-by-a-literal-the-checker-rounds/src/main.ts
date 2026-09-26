// expect: NTS1001 a method `1` with no declaration in the hierarchy
//
// A computed *read* whose key is a numeric literal the checker rounds:
// `k[0.9999999999999999]` must reach the member named "0.9999999999999999" -- a
// distinct double whose shortest round-trip string is itself -- but nts looks it up
// by the checker's value, 1, and refuses. Since 11013501 the declaration side takes
// the literal's exact value, so declaration and read now disagree the other way
// round. Reported by the compiler lane with that fix; the class-method form is used
// because its refusal comes from the hierarchy walk, whose message has been steady.
// The declaration side is guarded in tooling/conformance/outcomes/numeric-*.
class K {
  [0.9999999999999999](): string {
    return "almost-one";
  }
}
const k = new K();
export const read = k[0.9999999999999999]();
