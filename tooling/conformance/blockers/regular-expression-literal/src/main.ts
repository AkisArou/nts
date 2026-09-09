// expect: a regular expression literal, which needs a regular expression engine
//
// A regular expression literal at a use site. This is the honest refusal of the
// three `RegExp` forms -- it names what is missing rather than describing a
// lookup that failed -- and it is the one no lowering arm can answer on its own.
//
//     value.indexOf("a") >= 0    -> lowers
//     /a/.test(value)            -> REFUSED
//
// `controlIndexOf` is the control and does the same job without a pattern, so
// the refusal cannot be read as "string methods do not lower".
//
// **21 distinct sites**, counted as sites and not summed over module cones:
// `http` 11, `web-platform` 4, `internal` 3, `util` 2, `readline` 1. `http`'s
// eleven are header and URL grammar -- the places upstream writes a production
// as a pattern rather than a scanner -- so they are not incidental formatting.
// `internal/validators.ts:15` is `LINK_HEADER_VALUE`, which
// `validateLinkHeaderValue` needs, and that sits in the shared `internal/` every
// module imports.
//
// **This is the same gap as `regexp-as-a-property`, seen from a different
// position, and both are needed.** The forms and their messages:
//
//     /a/ at a use site      a regular expression literal, which needs a
//                            regular expression engine
//     class field `RegExp`   a property `x` of unrepresentable type (`RegExp`)
//     `new RegExp(p)` local  a `new` of unrepresentable type (`RegExp`)
//     module-scope literal   a module-scope variable whose initializer was
//                            refused above  (cascade)
//     returned from a fn     a function returning `RegExp`
//
// A fixture asserting one of those does not see the others, and `path` proved
// that the entry set alone decides which of them is printed for the same source
// -- see `docs/conformance/nodejs.md`. So this fixture asserts the literal and
// nothing else.
//
// **Ruled out on the way**: that a pattern with no metacharacters could be
// lowered as a substring search and the refusal is only about the hard ones.
// `/a/` below has no metacharacters and is refused identically. The decision is
// made on the syntax, before anything reads the pattern -- which is the right
// place for it, but it means "simple regexes could work" is not true today.
//
// Standing note: the engine is expected to come from QuickJS's, in C, alongside
// the unicode tables -- 42 sites and 47 sites. That makes this a dependency
// decision rather than a lowering arm, and it is why this fixture reports
// rather than proposes.

export function controlIndexOf(value: string): boolean {
  return value.indexOf("a") >= 0;
}

export function subjectLiteral(value: string): boolean {
  return /a/.test(value);
}
