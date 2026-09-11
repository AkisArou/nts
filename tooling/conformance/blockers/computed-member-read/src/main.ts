// expect: lowers
//
// FIXED, kept as a guard. The read half, and it needed one thing the write half
// did not.
//
// This fixture was split from `computed-member-write` so that a fix landing
// only writes would be *visible* rather than reported as done. It earned that:
// when the table representation landed, the write fixture went green and this
// one moved to a different refusal instead --
//
//     an `Object` static over something that is not an object here
//
// `bag[key]` was reading correctly and `Object.hasOwn(bag, key)` was not.
// `Object.keys` and `Object.hasOwn` over a *struct* are compile-time answers,
// because a layout's names are fixed when it is laid out; over a table they are
// questions about what is in it. `hasOwn` is `nts_map_has`, and the computed
// key a struct has to refuse is ordinary here.
//
// So the split did the job it was filed to do, one step later than expected.
//
// # Still refused, by name
//
// `Object.keys` of a table. The runtime has `nts_map_next` and
// `nts_map_key_at`, so it is a walk rather than a missing capability, and it is
// named separately for the reason this fixture exists: a fix for `hasOwn` is
// not a fix for `keys`.
//
// # Where it bites
//
// `querystring` builds a loadable addon that exports nothing, and this was one
// of four reasons. `main.ts:248` is
//
//     const current = Object.hasOwn(obj, key) ? obj[key] : undefined;
//
// on a `ParsedUrlQuery`, an interface whose whole purpose is an index
// signature. The other three are `decodeURIComponent` (provided since 2026-09-11, `examples/uri-encoding`), an
// `unknown` narrowed to BigInt (`narrowed-bigint`), and an object shorthand
// that is a cascade from the first.

interface ParsedQuery {
  [name: string]: string | string[];
}

export function read(bag: ParsedQuery, key: string): string {
  const current = Object.hasOwn(bag, key) ? bag[key] : undefined;
  return typeof current === "string" ? current : "";
}
