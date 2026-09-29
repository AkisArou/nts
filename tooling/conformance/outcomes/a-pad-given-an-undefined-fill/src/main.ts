// SIGSEGV: `"abc".padEnd(5, undefined)`. An explicit `undefined` fill string
// means the default, a space (StringPad: "If fillString is undefined, let
// filler be the String value consisting solely of the code unit 0x0020").
// nts passes it on and the runtime reads it as a string. The control,
// a-pad-given-no-fill, omits the argument and agrees. Found by test262's
// String/prototype/padEnd/fill-string-omitted.js and its padStart twin.
//
// The family is a nullish value handed to a string method where a string is
// wanted: `"gnulluna".indexOf(null)` -- `null` is ToString'd to "null" -- also
// segfaults (probed). Together 6 of the 7 SIGSEGV files at e32be23f8: this
// pair and four indexOf/lastIndexOf A1_T5/T7 tests. The seventh,
// statements/class/elements/static-field-redeclaration.js, is another shape.
observe("padEnd", "abc".padEnd(5, undefined));
done();
