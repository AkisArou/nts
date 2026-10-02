// An arrow that reads `this`, called before `super()` in a derived constructor
// whose base is a class: node throws a ReferenceError, nts reads the object.
//
// A derived constructor's `this` is uninitialised until `super()` returns.
// TypeScript rejects a `this` *written* before `super()` (TS17009), but not one
// inside an arrow, which can be called there. This compiler allocates the
// instance before the constructor runs, so the read succeeds. `extends null` is
// handled -- its `this` is never bound, which the syntax says -- and this is the
// part no syntax can answer: whether the arrow runs before or after `super()`
// is the order things execute in. Closing it means a binding state the arrow
// can test, which is a representation question, not a clause.
//
// **Control:** `after`, the same arrow called after `super()`, which both
// answer "none".
class Base {
  x = 1;
}

class Before extends Base {
  constructor() {
    const read = () => this.x;
    read();
    super();
  }
}

class After extends Base {
  constructor() {
    const read = () => this.x;
    super();
    read();
  }
}

function construct(early: boolean): string {
  try {
    if (early) {
      new Before();
    } else {
      new After();
    }
    return "none";
  } catch (e) {
    return e instanceof ReferenceError ? "ReferenceError" : "other";
  }
}

observe("before super (defect)", construct(true));
observe("after super (control)", construct(false));
done();
