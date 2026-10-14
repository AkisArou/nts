// An early SyntaxError nts compiles: a generator declaration as the body of an
// `if`. Only a plain function declaration is allowed there, and only in sloppy
// mode; this is strict. node refuses to load it; nts builds and runs it. Found by
// test262's negative statements/if/if-gen-else-stmt.js.
if (true) function* g() {} else ;
observe("ran", "yes");
done();
