// A lowerable stand-in for the Test262 harness entries every non-raw test gets.
//
// `docs/conformance/test262.md` permits this in as many words: "Test262 permits
// implementations to replace harness functions with equivalent functionality."
// The census needs that permission, because the shipped declaration asset
// cannot be used for it.
//
// # Why not `assets/test262/host.d.ts`
//
// That file is the right answer for the *runner*: ambient declarations whose
// identities are mapped to profile-owned intrinsics by `host-contract.json`.
// The mapping is one of the unimplemented prerequisites, so today
// `declare const assert` lowers as a module binding that has to be evaluated,
// and a test importing it refuses with
//
//   `assert` is read here while evaluating this module, and
//   `nts-workspace:///host.d.ts` -- which declares it -- has not been evaluated
//   yet; the two modules import each other
//
// Measured on one ordinary `bigint-arithmetic.js`: **918 refusals, every one of
// them the harness**, across three messages that are one cause. A census run
// that way would rank the harness at the top of every table and see nothing
// about the language, which is the failure it exists to avoid.
//
// # Why overloads rather than `unknown`
//
// `unknown` is refused by the lowerer today (`docs/any-unknown.md`), so
// `sameValue(actual: unknown, expected: unknown)` cannot lower. Overload
// signatures *do* lower -- `typescript.md` row 287 -- so each comparison the
// slice actually makes gets a signature, and the implementation signature stays
// `unknown` where TypeScript requires it but no call resolves to it.
//
// # This is prepended, not imported
//
// The materialiser concatenates this ahead of the test body in one file. An
// `import` would make the test a *module*, which changes top-level `var`
// scoping and `this`, and `docs/conformance/test262.md` is explicit that the
// units "must not be concatenated into a function or CommonJS wrapper: that
// changes global script semantics, strict-directive reach, parse phases, and
// declaration visibility". Prepending sibling top-level statements is none of
// those things -- the test's statements stay top-level in one script.
//
// # What it is not
//
// Not the harness. `assert.throws` needs a callback invoked and its exception
// caught, `propertyHelper.js` needs property descriptors, and `compareArray`
// needs iteration -- none of which lower. A test whose `includes:` names one of
// those is not in the census's leading slice, and the census says so rather
// than substituting a weaker stand-in.

class Test262Error {
  constructor(public readonly message: string) {}
}

class assert {
  static sameValue(actual: number, expected: number, message?: string): void;
  static sameValue(actual: string, expected: string, message?: string): void;
  static sameValue(actual: boolean, expected: boolean, message?: string): void;
  static sameValue(actual: unknown, expected: unknown, message?: string): void {
    if (!assert.isSameValue(actual, expected)) {
      throw new Test262Error(message ?? "sameValue");
    }
  }

  static notSameValue(actual: number, expected: number, message?: string): void;
  static notSameValue(actual: string, expected: string, message?: string): void;
  static notSameValue(actual: boolean, expected: boolean, message?: string): void;
  static notSameValue(actual: unknown, expected: unknown, message?: string): void {
    if (assert.isSameValue(actual, expected)) {
      throw new Test262Error(message ?? "notSameValue");
    }
  }

  /**
   * `SameValue`, which is **not** `!==`, and the difference is measurable.
   *
   * This stand-in compared with `!==` until 2026-09-19, which gets two values
   * wrong in the direction that matters: `NaN !== NaN`, so every test asserting
   * a NaN result failed *whatever the compiler answered*; and `+0 === -0`, so
   * every test distinguishing the zeros passed whatever it answered.
   *
   * `applying-the-exp-operator_A4.js` is the file that showed it -- "if base is
   * NaN and exponent is nonzero, the result is NaN", scored as a wrong answer
   * by the census while `probe.sh` had the same program agreeing with node.
   * An instrument finding itself, which is the direction to prefer, but it had
   * already been reported as four files that "ran and answered wrongly".
   *
   * Transcribed from `third_party/test262/harness/assert.js` rather than
   * reasoned about, which is the whole point of a stand-in: the shipped harness
   * is the specification of what this has to mean.
   */
  static isSameValue(a: unknown, b: unknown): boolean {
    if (a === b) {
      // The zeros are `===` and are not the same value. `1 / +0` is `Infinity`
      // and `1 / -0` is `-Infinity`, which is how they are told apart.
      return a !== 0 || 1 / (a as number) === 1 / (b as number);
    }
    // NaN is the only value not equal to itself, so this is the NaN case and
    // nothing else reaches it.
    return a !== a && b !== b;
  }
}
