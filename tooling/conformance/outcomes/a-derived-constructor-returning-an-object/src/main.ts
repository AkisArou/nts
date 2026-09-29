// A derived constructor that returns an object makes that object the result
// of `new`: `this` is discarded, so the result has no `prop` and is not an
// instance of the class. nts answers the discarded `this`. Found by test262's
// statements/class/subclass/derived-class-return-override-with-object.js.
// The control returns nothing and differs in that statement only.
class Base {
  prop: number;
  constructor() {
    this.prop = 1;
  }
}
class Returning extends Base {
  constructor() {
    super();
    return {} as Returning;
  }
}
class Plain extends Base {
  constructor() {
    super();
  }
}
const returned = new Returning();
const plain = new Plain();
observe("returned.prop", typeof returned.prop);
observe("returned instanceof", String(returned instanceof Returning));
observe("plain.prop", typeof plain.prop);
observe("plain instanceof", String(plain instanceof Plain));
done();
