// expect: emit-c -> emits-c nts_str_char_code_at
//
// The third of the position-field set, and the one that says the *boundary*
// widens a field's facts. Kept as a guard.
//
// `a-position-field-only-ever-increased` asserts the scan loop emits the
// unchecked `nts_unit`, and `a-position-field-decreased-behind-a-guard` asserts
// a guarded decrease keeps it. Both are about the whole-program field join, and
// both deliberately do **not** export the class.
//
// This one does, and asserts the opposite outcome for a reason that is not
// about the join at all. Exporting a class publishes its layout: `program.h`
// carries
//
//     struct NtsObj_Scanner { ... };
//     _Static_assert(offsetof(NtsObj_Scanner, at) == 32u, ...);
//
// so a C caller holding one can store anything into `at` at a documented
// offset, and a field the program never decrements can still arrive negative.
// The bounds check is therefore correct here and its absence would be a
// soundness bug, not an optimisation.
//
// **It does not need `--napi`.** Measured 2026-09-14 on one binary: the struct
// and the offset assertions are in `program.h` for a plain `emit-c`, so the
// widening keys on `export` because `export` is what publishes the layout.
//
// The cost is real and is the reason this is written down rather than assumed:
// every exported class pays a bounds check on fields a non-exported one proves
// in range. If that is ever narrowed -- to classes actually named in an
// emitted signature, say -- this fixture is where the narrowing has to argue
// its case, because flipping it back to `nts_unit` means C can write a field
// the compiler then trusts.
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
