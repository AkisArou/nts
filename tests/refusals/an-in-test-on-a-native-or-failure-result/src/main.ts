// expect: NTS1001 an `in` on something that is not an object, which JavaScript throws for is not supported by this lowering yet
// Reduced from the Modern Web Crypto profile findings.
// Only the successful result changes from Uint8Array to an ordinary object; both sides of the union are objects.
// Paired control: tests/programs/an-in-test-on-an-object-or-failure-result.

class Failure { readonly failure = "operation"; }
function result(n: number) { return n === 0 ? new Failure() : new Uint8Array(1); }
export function hasFailure(n: number): number { return "failure" in result(n) ? 1 : 0; }
