// Capital sigma lowercases to final sigma (U+03C2) at the end of a word and
// to U+03C3 elsewhere: SpecialCasing.txt's Final_Sigma condition, read from
// the original string. This was tests/outcomes/a-final-sigma-lowercased
// (found by test262's String/prototype/toLowerCase/
// special_casing_conditional.js and Final_Sigma_U180E.js) until the generated
// tables implemented the condition. The medial line is the control: a letter
// after the sigma, differing in that only.

const code = (s: string) =>
  Array.from(s)
    .map((c) => (c.codePointAt(0) ?? 0).toString(16))
    .join(" ");

export function final(seed: number): string {
  return code("A\u03A3".toLowerCase()) + ";" + ((seed | 0) & 1);
}

export function medial(seed: number): string {
  return code("A\u03A3B".toLowerCase()) + ";" + ((seed | 0) & 1);
}

// Case-ignorable characters are skipped on both sides: an apostrophe after
// the sigma does not stop it being final, and one before the cased letter
// does not stop it counting.
export function ignorable(seed: number): string {
  return (
    code("\u0391\u03A3'".toLowerCase()) +
    ";" +
    code("\u0391'\u03A3".toLowerCase()) +
    ";" +
    ((seed | 0) & 1)
  );
}
