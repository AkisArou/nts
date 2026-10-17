// expect: a type with no native ABI is not supported by this lowering yet
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a
// member answering a nullable number -- `input.selectionStart`,
// `input.selectionEnd` (IDL `unsigned long?`), an animation's
// `overallProgress` (`double?`) -- would bind as a foreign function
// whose return is `Float64 | null` (src/selection.d.ts), the adapter
// answering Blink's std::optional. A foreign return wants a scalar
// kind, a boolean, a string or void, so the answer is refused by name;
// there is no ABI for a number that may be null, in either direction (a
// `Float64 | null` parameter -- the setters -- is refused with the same
// words). Found 2026-10-17 by the Chromium lane binding nullable-number
// members.
//
// Control, one difference -- the same member shape answering a plain
// number, `input.maxLength` -- emits the call:
//
//     const input = document.createElement("input");
//     return input.maxLength;

export function go(): number {
  const input = document.createElement("input");
  const plain = input.maxLength;
  const start = input.selectionStart;
  return plain + (start === null ? 0 : start);
}
