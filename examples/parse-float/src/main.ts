// `parseFloat(string)`.
//
// The sibling of `parse-int`, and it is worth reading beside it: both stop at
// the first character their grammar does not admit, which is the whole of what
// they do that `Number(s)` does not. `Number("12abc")` is NaN and
// `parseFloat("12abc")` is 12.
//
// What it is *not* is `strtod` on the whole string. Three places that answers
// differently, and each is a wrong number rather than a rounding:
//
//     parseFloat("0x10")    is 0    -- it parses "0" and stops at 'x';
//                                      strtod reads a hexadecimal float and
//                                      answers 16
//     parseFloat("inf")     is NaN  -- strtod accepts "inf" and "nan"; the
//                                      language accepts only "Infinity"
//     parseFloat("1e")      is 1    -- the exponent needs a digit after it, so
//                                      the scan backs up rather than failing
//
// So the longest prefix the grammar admits is measured first and `strtod` is
// handed only that. The digits themselves still go to `strtod`, because
// rounding a decimal string to the nearest double is exactly what it is for and
// accumulating by multiplication loses the last bit.
//
// `1` call site in `runtime/node`, which is the smallest reach of anything in
// `blockers/the-number-parsing-builtins` -- it is here because the pair is the
// unit, not because the site is.

// A `switch` rather than an array read, for the reason `parse-int` records: a
// `texts[i]!` the harness cannot prove makes it *decline* the case, and a
// declined case is not a compared one.
function pick(n: number): string {
  switch (((n % 24) + 24) % 24) {
    case 0: return "3.14";
    case 1: return "  3.14";
    case 2: return "+3.14";
    case 3: return "-3.14";
    case 4: return "0x10";
    case 5: return "12abc";
    case 6: return "abc";
    case 7: return "";
    case 8: return "007.5";
    case 9: return ".5";
    case 10: return "5.";
    case 11: return "1e3";
    case 12: return "1E3";
    case 13: return "1e+3";
    case 14: return "1e-3";
    case 15: return "1e";
    case 16: return "Infinity";
    case 17: return "-Infinity";
    case 18: return "inf";
    case 19: return "NaN";
    case 20: return "\t\n 77.25 \r";
    case 21: return "1.7976931348623157e309";
    case 22: return "5e-324";
    default: return "-  5";
  }
}

/** The value, with NaN folded to a sentinel so the harness compares a number. */
export function parsed(n: number): number {
  const value = parseFloat(pick(n));
  if (Number.isNaN(value)) return -999999;
  if (value === Infinity) return 999999;
  if (value === -Infinity) return -888888;
  return value;
}

/**
 * Scaled, so a last-bit difference is visible rather than rounded away by the
 * harness printing. `5e-324` is the smallest subnormal and `.5` and `007.5`
 * both have to survive multiplication.
 */
export function scaled(n: number): number {
  const value = parseFloat(pick(n));
  if (!Number.isFinite(value)) return 0;
  return value * 1024;
}

/**
 * The contrast that makes the stopping rule the subject. `Number` and
 * `parseFloat` agree on well-formed text and disagree on every prefix, so this
 * is `parse-int`'s `noRadix`/`radixTen` pair in the form this builtin has.
 */
export function againstNumber(n: number): number {
  const text = pick(n);
  const a = parseFloat(text);
  const b = Number(text);
  const same = (Number.isNaN(a) && Number.isNaN(b)) || a === b;
  return same ? 1 : 0;
}
