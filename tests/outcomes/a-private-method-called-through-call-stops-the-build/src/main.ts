// run: build
//
// `this.#m.call(this)` calls the private method with an explicit receiver;
// node prints "TT". nts reads the method as a function value, and the call
// through it passes the receiver as an erased value to a method that takes a
// `C`, so its own verifier rejects the program: "invalid HIR: CallArgumentType
// { ... expected: Managed(Object(..)), found: Erased }". A receiver that is not
// a `C` at all stops the same way, which is what test262
// language/statements/class/elements/super-access-inside-a-private-method
// does in the census of 2026-11-06 on pin e0395d27506b. The control,
// a-private-method-called-through-call-stops-the-build-control, calls
// `this.#m()` directly and agrees. The defect stops the build, so the control
// is a fixture of its own.
class A {
  method(): string { return "T"; }
}
class C extends A {
  #m(): string { return super.method(); }
  access(): string { return this.#m.call(this); }
}
const c = new C();
observe("access", c.access() + c.access());
done();
