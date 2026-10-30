// expect: NTS1001 a call result of unrepresentable type (null) is not supported by this lowering yet
// Reduced from the Modern Web Crypto profile findings.
// Only the helper return annotation changes from null to number | null; both helpers actually return null.
// Paired control: tests/programs/a-null-result-has-a-number-representation.

function unspecified(): null { return null; }
export function keyLength(n: number): number {
  const value = unspecified();
  return value === null ? n : value;
}
