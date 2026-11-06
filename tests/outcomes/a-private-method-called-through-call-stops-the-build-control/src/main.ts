// run: build
//
// The control for a-private-method-called-through-call-stops-the-build: the
// same private method called directly, `this.#m()`, instead of through `call`.
// It compiles and prints "TT", as node does.
class A {
  method(): string { return "T"; }
}
class C extends A {
  #m(): string { return super.method(); }
  access(): string { return this.#m(); }
}
const c = new C();
observe("access", c.access() + c.access());
done();
