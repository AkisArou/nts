// The assertion harness a probe body is prepended to.
//
// Deliberately written so that **node can run this file as-is** under
// `--experimental-strip-types`, which is what makes it an oracle:
//
//   * no parameter properties. `constructor(public readonly message: string)`
//     is a *transform* rather than an erasure, and node refuses the file;
//   * no `enum`, `namespace`, or anything else TypeScript emits code for.
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
