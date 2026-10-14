// A wrong answer: `"\uD800\uDBFF".codePointAt(0)` is 0xD800 -- a leading
// surrogate not followed by a trailing one is its own code point
// (CodePointAt: "If first is a leading surrogate and second is not a
// trailing surrogate, return first"). The control,
// code-point-at-a-surrogate-pair, reads a valid pair and agrees. Found by
// test262's String/prototype/codePointAt/return-first-code-unit.js and
// return-single-code-unit.js, e32be23f8.
observe("codePointAt", String("\uD800\uDBFF".codePointAt(0)));
done();
