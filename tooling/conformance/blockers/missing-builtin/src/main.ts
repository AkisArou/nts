// expect: `decodeURIComponent`, a builtin this compiler does not provide
//
// `decodeURIComponent` is not provided, and it gates `querystring`. Its `parse`
// calls it on every value that contains a percent, so the refusal takes `parse`,
// and `decode` with it since that is the same function under another name.
//
// Filed because it was named in this lane's analysis for hours without ever
// being reduced. It is one line, and having it as a fixture rather than a
// sentence is the difference between an inventory and a recollection --
// `blockers/` is now the list of what stands between this profile and a compiled
// artifact, and a blocker that lives only in prose is not on that list.
//
// Not the same shape as the other refusals here: nothing about this is
// unrepresentable. It is a builtin the compiler has not implemented, so it will
// be closed by writing it rather than by deciding anything.
//
// # What it is worth, measured
//
// `querystring` is on the compiled axis with **one** pass. Running node's
// `querystring` suite against the compiled addon: 9 files, 1 passed, 7 failed,
// 1 not applicable, and **six of the seven failures stop at `parse` being
// absent** --
//
//     3  qs.parse is not a function
//     1  parse is not a function
//     1  parse is missing
//     1  parse/%
//
// The seventh wants `decode`, `encode`, `stringify`, `unescape` and
// `unescapeBuffer` as well, so it does not turn on this alone.
//
// `cascade-reach.mjs` puts `unescape` at a cone of 3 in `querystring` and says
// it "unblocks 1 missing export: parse". Small cone, largest visible payoff in
// the module.
//
// **Six files is what stands in front of them, not what they would gain.** A
// test failing at `parse is not a function` fails there because that is the
// first question it asks; clearing it reveals the second. The honest claim is
// that one unimplemented builtin is the whole distance to those six files
// asking a different question, on a module already on the axis -- which is a
// better place to spend an afternoon than a representation that would take
// several.
export function decodeOne(input: string): string {
  return decodeURIComponent(input);
}
