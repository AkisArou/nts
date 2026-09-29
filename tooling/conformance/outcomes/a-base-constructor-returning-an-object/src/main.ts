// A constructor that returns an object makes that object the result of
// `new`, so the result is not an instance of the class; nts answers `this`.
// The same as a-derived-constructor-returning-an-object, for a class with no
// base. Found by test262's staging/sm/class/stringConstructor.js. The
// control returns nothing and differs in that statement only.
class Returning {
  constructor() {
    return {} as Returning;
  }
}
class Plain {
  constructor() {}
}
observe("returning", String(new Returning() instanceof Returning));
observe("plain", String(new Plain() instanceof Plain));
done();
