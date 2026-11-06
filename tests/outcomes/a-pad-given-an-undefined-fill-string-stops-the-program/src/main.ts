// run: build
//
// `padStart` and `padEnd` given a fill string that is `undefined` pad with
// spaces in node, exactly as if the fill were omitted. nts supplies the space
// only when the argument is missing from the call: an optional `fill?: string`
// that holds `undefined` reaches the runtime's pad helper as though it were a
// string, and the program ends on a signal at run time. Plain strict
// TypeScript. Found by test262's String/prototype/padStart/fill-string-omitted.js
// and its padEnd twin.
//
// The control, a-pad-given-an-undefined-fill-string-stops-the-program-control,
// passes " " instead of `undefined`, which is what an omitted fill means.
function padStart(text: string, fill?: string): string {
  return text.padStart(6, fill);
}
function padEnd(text: string, fill?: string): string {
  return text.padEnd(6, fill);
}
observe("padStart", padStart("abc") + "|");
observe("padEnd", padEnd("abc") + "|");
done();
