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
export function decodeOne(input: string): string {
  return decodeURIComponent(input);
}
