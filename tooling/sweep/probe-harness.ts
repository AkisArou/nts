// The assertion harness a probe body is prepended to.
//
// Node runs TypeScript's own program emit through the shared oracle entry.
//
// Overload signatures are fine — they are declarations without bodies — and they
// are here for the same reason `tooling/census/harness.ts` has them: `unknown`
// parameters would not lower, so each comparison the probes make gets a
// signature and the implementation signature is never resolved to.
class Test262Error {
  message: string;
  constructor(message: string) {
    this.message = message;
  }
}

class assert {
  static sameValue(actual: number, expected: number, message?: string): void;
  static sameValue(actual: string, expected: string, message?: string): void;
  static sameValue(actual: boolean, expected: boolean, message?: string): void;
  static sameValue(actual: unknown, expected: unknown, message?: string): void {
    if (actual !== expected) {
      throw new Test262Error(message ?? "sameValue");
    }
  }
}
