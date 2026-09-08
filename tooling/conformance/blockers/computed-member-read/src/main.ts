// expect: `key`, which `ParsedQuery` does not declare
//
// The *read* half of `computed-member-write`, split out because the two can be
// fixed independently and a single fixture could not tell them apart.
//
// Same underlying representation decision -- an index-signature type has no
// members and its keys are not known until run time, so access has to route
// through a typed `NtsMap` -- and that fixture's comment already scopes the fix
// to "property access and `Object.keys`", plural. This one exists so that a fix
// which lands writes and not reads is *visible* rather than reported as done:
// `computed-member-write` would flip to `guard ok` and nothing would say the
// other half was still open.
//
// Where it bites, which is not `os`: `querystring` builds a loadable addon that
// **exports nothing at all**, and this is one of four reasons. `main.ts:248` is
//
//     const current = Object.hasOwn(obj, key) ? obj[key] : undefined;
//
// on a `ParsedUrlQuery`, which is an interface whose whole purpose is an index
// signature. The other three are `decodeURIComponent` (`missing-builtin`), an
// `unknown` narrowed to BigInt (`narrowed-bigint`), and an object shorthand that
// is a cascade from the first -- `export const QueryString = { parse, escape,
// ... }` names things whose lowering was already refused, so it reports "a
// shorthand naming nothing in scope" and looks like a fifth problem.
//
// The diagnostic is worth reading twice. `ParsedQuery` **does** declare this
// access -- `[name: string]: string | string[]` is exactly what an index
// signature is for -- so "which `ParsedQuery` does not declare" describes the
// lowering's model rather than the type. That wording is what made the same
// message on the write side look like a small missing-member gap for hours.

interface ParsedQuery {
  [name: string]: string | string[];
}

export function read(bag: ParsedQuery, key: string): string {
  const current = Object.hasOwn(bag, key) ? bag[key] : undefined;
  return typeof current === "string" ? current : "";
}
