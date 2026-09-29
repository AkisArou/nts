// SIGSEGV. A constructor parameter's default may read a private field --
// `constructor(o = this.#x)` -- because fields are initialised before the
// parameters of a base class's constructor are bound. nts crashes, and a
// public field read the same way crashes too, so privacy is not the cause.
// Found by test262's staging/sm/PrivateName/constructor-args.js. An abort
// erases every arm, so the control is its own fixture: a-literal-
// constructor-default, whose default reads no field.
class A {
  #x = "hello";
  value: string;
  constructor(o = this.#x) {
    this.value = o;
  }
}
observe("value", new A().value);
done();
