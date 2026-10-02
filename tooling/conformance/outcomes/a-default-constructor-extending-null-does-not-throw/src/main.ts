// `new C()` where `class C extends null {}` writes no constructor: node throws a
// TypeError, nts answers an object.
//
// The default constructor of a derived class is `constructor(...args) {
// super(...args) }`, and `super` here is `null`, which is not a constructor. A
// written constructor is handled -- its `this` is never bound, so every read of
// it and every way out throws a ReferenceError -- and the throw is emitted in
// the constructor's body. A class with no constructor has no body to emit it
// in, and modelling the default one is its own change.
//
// **Control:** `written`, the same class with a written constructor, which both
// answer "ReferenceError".
class Defaulted extends null {}

class Written extends null {
  constructor() {}
}

function construct(defaulted: boolean): string {
  try {
    if (defaulted) {
      new Defaulted();
    } else {
      new Written();
    }
    return "none";
  } catch (e) {
    return e instanceof TypeError ? "TypeError" : e instanceof ReferenceError ? "ReferenceError" : "other";
  }
}

observe("default constructor (defect)", construct(true));
observe("written constructor (control)", construct(false));
done();
