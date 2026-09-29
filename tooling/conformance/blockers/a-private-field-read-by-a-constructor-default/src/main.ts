// expect: NTS1001 a constructor's parameter default that reads `this`, whose fields the constructor has not yet written
//
// `constructor(o = this.#x)` reads a field the class initialises before
// binding its constructor's parameters. nts fills a default at the call site,
// where a `new` has allocated the object but not yet run its field
// initialisers: until 702ab2982 that read an uninitialised slot (SIGSEGV, an
// outcomes record); now it refuses. The fix is the callee evaluating its own
// default after its fields -- the same work an-explicit-undefined-at-a-
// defaulted-parameter waits on. Found by test262's staging/sm/PrivateName/
// constructor-args.js.
class A {
  #x = "hello";
  value: string;
  constructor(o = this.#x) {
    this.value = o;
  }
}
if (new A().value !== "hello") throw new Error("the default did not read the field");
