// expect: emit-c -> emits-c nts_unit
//
// The companion to `a-position-field-only-ever-increased`, and the half that
// says the field join is precise rather than merely sound.
//
// A method decreases the position behind a guard. The field's facts are a
// whole-program join over every store, so a decrease in *any* method is visible
// to the scan loop in this one -- and the guard is visible with it, so the
// unchecked `nts_unit` survives.
//
// Remove the `if` and the read becomes `nts_str_char_code_at`, correctly: an
// unguarded `at - 1` on a field that can be zero produces `-1`, and the scan
// below would index it. That is the check working, and mistaking it for a
// missed optimisation is what this pair exists to prevent.//
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

  back(): void {
    const at = this.at;
    if (at > 0) this.at = at - 1;
  }
}

export function run(text: string): number {
  const scanner = new Scanner(text);
  scanner.back();
  return scanner.scan();
}
