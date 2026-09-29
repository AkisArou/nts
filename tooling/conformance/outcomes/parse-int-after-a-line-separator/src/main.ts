// A wrong answer: `parseInt(LS + "1")` is 1, where LS is U+2028 LINE
// SEPARATOR -- a LineTerminator, which StrWhiteSpaceChar includes, so
// parseInt trims it (and U+2029 too). The control, parse-int-after-a-space,
// trims a space and agrees. Found by test262's built-ins/parseInt/
// S15.1.2.2_A2_T8/T9/T10 and parseFloat's A2_T8/T9/T10, six files at
// e32be23f8. The separator is an escape, never the raw character: a raw
// U+2028 ends a `//` comment.
observe("parseInt(LS 1)", String(parseInt("\u20281")));
done();
