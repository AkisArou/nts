// Reduced from the Modern Web Crypto profile findings.
// Only the helper return annotation changes from null to number | null; both helpers actually return null.
// Paired refusal: tests/refusals/a-null-only-function-result-is-observed.

function unspecified(): number | null { return null; }
export function keyLength(n: number): number {
  const value = unspecified();
  return value === null ? n : value;
}
