// expect: a property `expression` of unrepresentable type (`RegExp`)
//
// A class field typed `RegExp`. The refusal is about the *field*, not about
// matching: `RegExp` has no representation, so a class that stores one has no
// layout, and the declaration is refused before anything runs a pattern.
//
//     readonly pattern: string     -> lowers
//     readonly expression: RegExp  -> REFUSED
//
// `Representable` is the control and must stay clean, or the diagnostic reads
// as "a class with readonly fields is refused", which is false.
//
// Distinct from "a regular expression literal, which needs a regular expression
// engine", which is what `/x/` reports at a use site. This one needs no engine
// to reproduce -- no literal appears below -- and a fix for one does not imply
// the other. `querystring`, `http` and `readline` all carry the literal form;
// `path` carries this one.
//
// Four of `path`'s six own-source roots are this single field, reported at each
// site that reaches it, in `src/glob-matcher.ts`. `GlobSegmentMatcher` holds a
// compiled anchored pattern and is the whole matcher, so `path`'s glob surface
// is behind it.

export class Representable {
  readonly pattern: string;
  readonly allowsEmpty: boolean;

  constructor(pattern: string) {
    this.pattern = pattern;
    this.allowsEmpty = pattern.length === 0;
  }
}

export class Subject {
  readonly pattern: string;
  readonly expression: RegExp;

  constructor(pattern: string, expression: RegExp) {
    this.pattern = pattern;
    this.expression = expression;
  }
}
