// expect: emit-c -> emits-c nts_unit
//
// A scan loop over a position field emits `nts_unit`, the **unchecked** read.
// This is a guard on behaviour that is correct, and it exists because I filed a
// fixture claiming the opposite and was wrong.
//
// The claim was that one `this.at = at - 1` in an unrelated method costs every
// reader of that field its bounds check, because a field's facts are a
// whole-program join. The emitted C agreed: adding such a method turned this
// `nts_unit` into `nts_str_char_code_at`.
//
// **The analysis was right and the fixture was wrong.** An unguarded `at - 1`
// on a field that can be `0` really does produce `-1`, and a later `scan` would
// really index it. The check was not a missed optimisation, it was the check
// doing its job. Guard the subtraction --
//
//     back(): void {
//       const at = this.at;
//       if (at > 0) this.at = at - 1;
//     }
//
// -- and `nts_unit` comes back, which is the second half and the one that
// settles it: the join is not too coarse to see a guard.
//
// So this file asserts the good case, and `a-position-field-decreased-behind-a-
// guard` beside it asserts that a guarded decrease keeps it. Between them they
// say the analysis is sound *and* precise here, which is what I should have
// established before writing a record about a gap.
//
// What remains unestablished is whether `json/parse.ts`'s own `at - 1` -- on a
// throw path, where the position is at least one for reasons no explicit guard
// states -- is provable. That is a real question and it is not this one.

export class Scanner {
  readonly source: string;
  at = 0;

  constructor(source: string) {
    this.source = source;
  }

  scan(): number {
    const source = this.source;
    const length = source.length;
    let at = this.at;
    while (at < length) {
      if (source.charCodeAt(at) === 34) break;
      at++;
    }
    this.at = at;
    return at;
  }
}

export function run(text: string): number {
  return new Scanner(text).scan();
}
