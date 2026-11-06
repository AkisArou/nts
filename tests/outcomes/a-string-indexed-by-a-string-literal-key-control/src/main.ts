// run: build
//
// The control for a-string-indexed-by-a-string-literal-key: the same reads
// written as a property access and a number index, `s.length` and `s[1]`. It
// compiles and prints 11 and "e", as node does.
const s: string = "hello world";
observe("length", String(s.length));
observe("one", s[1]);
done();
