// A separate module on purpose. `docs/any-unknown.md` argues that the cheapest
// representation for `console`'s `unknown` is decided by a use in `node:util`,
// and a fixture where every use is in one file could not tell a whole-program
// analysis from a per-file one.
export function reads(value: any): number {
  return value.length;
}
