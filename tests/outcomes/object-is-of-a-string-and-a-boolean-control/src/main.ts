// run: build
//
// The control for object-is-of-a-string-and-a-boolean: the same call with two
// strings. It compiles and prints true, as node does.
observe("string and string", String(Object.is("", "")));
done();
