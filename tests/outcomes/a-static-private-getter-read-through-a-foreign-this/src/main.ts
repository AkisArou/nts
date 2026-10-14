// A static method reading a static private accessor, called with a `this`
// that is not the class -- `C.access.call({})` -- must throw a TypeError: the
// object has no `#f` (the private-name brand check). nts answers the getter's
// value. Found by test262's {statements,expressions}/class/elements/
// static-private-getter.js, refused until 8f18d73ba, which published it. The
// control calls the method on its class and differs in the receiver only.
class C {
  static get #f(): string {
    return "Test262";
  }
  static access(): string {
    return this.#f;
  }
}
let foreign = "no throw";
try {
  foreign = C.access.call({});
} catch (e) {
  foreign = e instanceof TypeError ? "TypeError" : "another error";
}
observe("own class", C.access());
observe("foreign this", foreign);
done();
