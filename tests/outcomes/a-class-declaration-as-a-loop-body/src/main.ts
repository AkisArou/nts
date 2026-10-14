// An early SyntaxError nts compiles: a class *declaration* in statement position.
// `while (false) class C {}` is not a program -- node refuses to load it -- and nts
// builds and runs it. tsgo recovers and answers anyway, so early errors are the one
// check nts cannot delegate to its frontend. Found by test262's negative
// statements/while/decl-cls.js, judged phase-exactly by conformance262.
while (false) class C {}
observe("ran", "yes");
done();
