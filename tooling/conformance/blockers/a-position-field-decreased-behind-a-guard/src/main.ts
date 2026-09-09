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
// missed optimisation is what this pair exists to prevent.
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
