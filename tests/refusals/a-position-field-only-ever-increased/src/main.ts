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
//
// **2026-09-14: the class is deliberately not exported, and that is the point.**
// It was `export class Scanner` and both halves of this pair went quiet --
// reported as `FIXED ... no longer emits it`, which is the reassuring word for
// the wrong outcome. The unchecked read had been lost.
//
// Exporting a class publishes its layout: `program.h` emits `struct
// NtsObj_Scanner` with `_Static_assert(offsetof(NtsObj_Scanner, at) == 32u)`,
// so a C caller can write the field at a documented offset, and the field's
// facts must widen to whatever C might store. That is correct and it is
// `a-position-field-published-to-c` beside this file, which asserts it.
//
// It is also a *different property* from the one this fixture is for. Measured
// on one binary, one variable changed:
//
//     export class Scanner   ->  nts_str_char_code_at 1, nts_unit 0
//            class Scanner   ->  nts_unit 1, nts_str_char_code_at 0
//
// So the boundary effect swamped the join it was written to measure. Dropping
// `export` restores the measurement; `run` is still exported, so the class is
// still reached and still lowered. Kept as a guard.

class Scanner {
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
