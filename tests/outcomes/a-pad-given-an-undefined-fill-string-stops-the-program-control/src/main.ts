// run: build
//
// The control for a-pad-given-an-undefined-fill-string-stops-the-program: the
// same calls given a fill string of one space, which is what an omitted fill
// means, so node prints the same padding.
function padStart(text: string, fill?: string): string {
  return text.padStart(6, fill);
}
function padEnd(text: string, fill?: string): string {
  return text.padEnd(6, fill);
}
observe("padStart", padStart("abc", " ") + "|");
observe("padEnd", padEnd("abc", " ") + "|");
done();
