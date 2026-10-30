// Reduced from the Modern Web Crypto profile findings.
// Only the successful result changes from Uint8Array to an ordinary object; both sides of the union are objects.
// Paired refusal: tests/refusals/an-in-test-on-a-native-or-failure-result.

class Failure { readonly failure = "operation"; }
function result(n: number) { return n === 0 ? new Failure() : { value: 1 }; }
export function hasFailure(n: number): number { return "failure" in result(n) ? 1 : 0; }
